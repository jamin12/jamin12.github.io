---
title: subscriptionId 중복으로 생긴 고아 Job
date: 2026-04-23
tags: [websocket, debugging, kotlin, concurrenthashmap]
series: 실시간 로그 스트리밍 구축기
seriesOrder: 6
---

구현을 다 하고 테스트를 돌려보다 발견한 버그 하나를 기록한다. 단순한 Map put 의 정상 동작이 Job 누수로 이어지는 케이스였는데, stateful 한 WebSocket 구조에서 나오기 쉬운 패턴이라 교훈이 있다.

## 같은 subscriptionId 로 두 번 subscribe 하면 어떻게 되나

`SubscriptionRegistry.subscribe` 의 초기 구현은 이랬다.

```kotlin
fun subscribe(
  sessionId: String,
  subscriptionId: String,
  type: String,
  job: Job,
): Boolean {
  val session = sessions[sessionId] ?: return false
  if (session.subscriptions.size >= MAX_SUBSCRIPTIONS) return false
  session.subscriptions[subscriptionId] = SubscriptionInfo(sessionId, subscriptionId, type, job)
  return true
}
```

언뜻 문제없어 보인다. 그런데 FE 가 같은 `subscriptionId` 로 두 번 subscribe 를 보내면 어떻게 될까.

`ConcurrentHashMap` 의 `[key] = value` 는 put 연산이라 **기존 엔트리를 덮어쓴다**. 그러면 이전 엔트리에 들어있던 Job 참조는 Registry 에서 사라진다. 하지만 **그 Job 은 여전히 실행 중** 이다. `scope.launch { flow.collect { ... } }` 로 발사된 코루틴은 `job.cancel()` 이 명시적으로 호출돼야 종료되는데, Registry 가 참조를 잃어버렸으니 이제 **아무도 그 Job 을 취소할 수 없다**.

결과적으로:

- 기존 구독의 Job 은 고아가 되어 백그라운드에서 계속 돈다
- 해당 Job 이 쥔 K8s LogWatch 도 닫히지 않는다
- FE 가 같은 id 로 unsubscribe 를 보내도 Registry 는 **새로 등록된** (두 번째) Job 만 취소한다
- 첫 번째 Job 과 LogWatch 는 서버 재시작까지 살아있다

이 상태에서 같은 id 로 여러 번 subscribe 를 반복하면 한 세션만으로도 서버 자원을 고갈시킬 수 있다. MAX_SUBSCRIPTIONS 제한도 우회된다 (Registry 맵의 크기는 늘 1 이니까).

해결은 **`putIfAbsent`** 다. "이미 있으면 넣지 않고 기존 값 반환" 을 원자적으로 한다.

```kotlin
enum class SubscribeResult {
  OK, SESSION_NOT_FOUND, LIMIT_EXCEEDED, DUPLICATE,
}

fun subscribe(
  sessionId: String, subscriptionId: String, type: String, job: Job,
): SubscribeResult {
  val session = sessions[sessionId] ?: return SubscribeResult.SESSION_NOT_FOUND
  if (session.subscriptions.size >= MAX_SUBSCRIPTIONS) return SubscribeResult.LIMIT_EXCEEDED
  val existing = session.subscriptions.putIfAbsent(
    subscriptionId, SubscriptionInfo(sessionId, subscriptionId, type, job)
  )
  return if (existing == null) SubscribeResult.OK else SubscribeResult.DUPLICATE
}
```

반환 타입도 Boolean 에서 enum 으로 바꿨다. 거부 사유가 세 가지 (세션 없음 / 제한 초과 / 중복) 인데 Boolean 은 구분하지 못해서 Handler 쪽이 어떤 에러 메시지를 보내야 할지 알 수 없었다. enum 으로 가면 when 분기로 정확한 메시지를 FE 에 돌려줄 수 있다.

```kotlin
when (subscriptionRegistry.subscribe(session.id, msg.subscriptionId, type, job)) {
  SubscribeResult.OK -> { /* 정상 */ }
  SubscribeResult.DUPLICATE -> {
    job.cancel()
    sendError(session, msg.subscriptionId, "이미 사용 중인 subscriptionId: ${msg.subscriptionId}")
  }
  SubscribeResult.LIMIT_EXCEEDED -> {
    job.cancel()
    sendError(session, msg.subscriptionId, "구독 제한 초과 (최대 ${MAX_SUBSCRIPTIONS}개)")
  }
  SubscribeResult.SESSION_NOT_FOUND -> {
    job.cancel()
    sendError(session, msg.subscriptionId, "세션을 찾을 수 없습니다")
  }
}
```

DUPLICATE 분기에서 `job.cancel()` 이 꼭 필요하다. Handler 는 Registry 를 호출하기 **전에** 이미 Job 을 launch 했다. 거부됐을 때 수동으로 정리하지 않으면 새로 만든 Job 이 그대로 고아가 된다. 바로 그 문제를 막으려던 거였으니 같이 신경 써야 한다.

## 교훈

**구현은 맞는데 겉으로 틀려 보이는** 유형의 버그였다. `ConcurrentHashMap.put` 이 기존 값을 덮어쓰는 건 Kotlin/Java 의 정상 동작이다. 단지 그 Map 이 들고 있던 값이 **외부 리소스에 대한 참조 (K8s LogWatch 를 쥔 Job)** 였기에, 덮어쓰는 순간 리소스가 고아가 됐을 뿐이다.

WebSocket 처럼 stateful 한 프로토콜은 한 번의 메시지가 아니라 **상태 전이의 연속** 으로 이해해야 한다. 한 상태를 덮어쓴다는 건 이전 상태에 물려있던 리소스를 같이 잃는다는 뜻이다. 참조가 사라진 Job 은 아무도 취소할 수 없고, 그 Job 이 쥔 외부 리소스도 영원히 남는다.

해결의 관점도 둘이다. `putIfAbsent` 로 **덮어쓰기 자체를 원자적으로 차단** 하는 것이 직접적 방어, `SubscribeResult` enum 으로 **거부 사유를 FE 에 명시적으로 전달** 하는 것이 진단 가능성 확보. 이 두 가지가 함께 있어야 같은 류의 버그가 다시 생겼을 때 "무슨 일이 일어났는지" 가 로그와 에러 메시지에 드러난다.
