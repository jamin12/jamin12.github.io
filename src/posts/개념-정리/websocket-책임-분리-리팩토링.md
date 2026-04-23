---
title: 책임 분리 리팩토링과 회고
date: 2026-04-23
tags: [websocket, refactoring, hexagonal, architecture]
series: 실시간 로그 스트리밍 구축기
seriesOrder: 7
---

첫 구현이 돌아가고 테스트가 녹색이 된 뒤, 구조를 한 번 더 다듬는 Phase 를 뒀다. Handler 한 덩어리에 책임이 몰려 있었고, 패키지 위치도 시간이 지나면 혼란스러울 이름이었다. 이 두 가지를 정리한 과정이다.

## Handler 에서 분리한 두 가지

초기 Handler 는 한 클래스 안에서 세 가지를 다 하고 있었다.

- subscribe 메시지의 `params` 를 파싱해서 도메인 Command 로 변환
- type 에 맞는 UseCase 호출 (`type == "pod-log" → WatchPodLogUseCase`)
- Flow emission 을 WebSocket 메시지로 변환해서 send

첫 번째 문제는 **params 파싱 로직이 Handler 에 있다는 것** 이다. 파싱은 **입력 어댑터** 의 책임이다. REST 에서 `@RequestBody` 가 JSON 을 DTO 로 바꾸고 Controller 는 이미 검증된 DTO 를 UseCase 에 넘기는 것과 같은 역할 분담을 WebSocket 에서도 지켜야 한다.

두 번째 문제는 **UseCase 가 도메인 중립 타입을 반환하고 있었다는 것** 이다. 초기엔 공통 `StreamInPort` 인터페이스가 있어서 `WatchPodLogUseCase` 가 `StreamInPort` 를 구현하며 `Flow<StreamPayload>` 를 돌려줬다. UseCase 가 WebSocket 전송용 타입 (`StreamPayload`) 을 알고 있는 건 레이어링 위반이다. UseCase 는 도메인 결과 (로그 라인 `String`) 만 알고, 전송 래핑은 어댑터가 해야 한다.

이 두 가지를 고치는 방향은 자연스럽게 따라왔다. **어댑터 계층을 하나 더 세운다**.

```
[예전]
Handler ─ params 파싱 ─ StreamInPort.execute(params) → Flow<StreamPayload>
                         │
                         └─ WatchPodLogUseCase (params 파싱 + systemUser 조립 + String → StreamPayload)

[지금]
Handler ─ Stream.execute(params) → Flow<StreamPayload>
          │
          └─ PodLogStream (params 파싱 + InPort 호출 + Flow<String> → Flow<StreamPayload>)
              │
              └─ WatchPodLogInPort.execute(command) → Flow<String>
                  │
                  └─ WatchPodLogUseCase (systemUser 조립, OutPort 호출, 순수 Command 입력)
```

`Stream` 은 REST 의 `Controller` 에 대응하는 **WebSocket 입력 어댑터** 의 인터페이스가 되었다. `Handler` 는 이 어댑터들의 dispatch 만 담당한다. `UseCase` 는 전송 개념을 모르고 Command 만 받는다. 각 레이어가 자기 책임만 갖고, 테스트도 쉬워졌다.

이름 짓기에서 한 차례 헤맸다. 처음엔 공통 인터페이스 이름을 `StreamInPort` 로 뒀는데, 이건 애플리케이션 계층 언어다. 어댑터 계층에 들어있는데 이름이 InPort 면 한 번 더 생각하게 된다. `Stream` 으로 바꾼 뒤로 "어댑터들의 공통 계약" 이라는 의미가 더 선명해졌다.

## 패키지는 어디에 두어야 하는가

구조를 정리하니 패키지 위치도 걸렸다. 초기엔 이랬다.

```
kubeManagement/
  adapter/
    stream/
      websocketIn/
        config/
        handler/
        dto/
        registry/
        scheduler/
        stream/
```

`stream/` 이 최상위 어댑터 디렉토리라 다른 도메인들과 같은 레벨에 있었다.

```
adapter/
  argo/
  cluster/
  namespace/
  stream/           ← 도메인인가?
  workload/
  ...
```

`stream/` 은 도메인이 아니다. WebSocket 기반 실시간 입력을 처리하는 **공통 인프라** 다. 이 위치는 "스트림이라는 도메인이 있는 것처럼" 오해하게 만든다.

고민의 축이 두 가지였다. 첫째, 최상위 `com.nhn.inje.ccp.config/` 에 둘 것인가. 둘째, `adapter/config/` 아래로 갈 것인가.

프로젝트를 살펴보니 이미 관례가 있었다.

```
com.nhn.inje.ccp/
  config/             # outbox 등 layer-무관 오케스트레이션
  adapter/
    config/           # aspect, async, resolver, Feign clients — cross-cutting 인프라
    ...
  application/
  domain/
```

`adapter/config/` 에는 `@Component` 가 여럿 있었다. 예를 들어 `K8SAuthResolver`, `K8SCustomPrincipalAspect`. "config 는 `@Configuration` 만 들어간다" 는 관례가 아니라, **어댑터 계층의 cross-cutting 인프라** 를 모으는 곳으로 쓰고 있었다.

우리 WebSocket 인프라가 정확히 여기 들어맞는다. Handler, Registry, Scheduler, Stream 인터페이스 모두 어댑터 계층에서 쓰이는 인프라 컴포넌트다. 그래서 최종 위치는 이렇게 되었다.

```
adapter/
  config/
    aspect/
    async/
    resolver/
    websocket/              ← 여기
      WebSocketConfig.kt
      dto/
      handler/
      registry/
      scheduler/
      stream/
  argo/
  cluster/
  ...
```

최상위 `ccp.config/` 로 올리지 않은 이유는 레이어 경계 때문이다. WebSocket Handler 는 `application.workload.pod.stream.port.inbound.WatchPodLogInPort` 를 호출한다. 이 호출은 "어댑터 레이어가 애플리케이션 레이어를 호출" 하는 정방향 의존이어야 한다. Handler 가 최상위 config 에 있으면 "config 가 application 을 호출" 하는 모양이 되는데, config 는 레이어가 모호해서 헥사고날 의존 방향을 흐린다.

## 남은 숙제

인프라는 서있고 Pod 로그가 첫 도메인으로 붙었다. 아직 안 된 것들이 꽤 있다.

**다른 도메인 추가.** PipelineRun step 로그, 파이프라인 실행 로그, 배포 애플리케이션 Pod 로그까지 네 개가 같은 인프라 위에 얹혀야 한다. 각각 `Stream` 인터페이스 구현체 하나와 그에 대응하는 UseCase / OutPort / Adapter 가 붙는다.

**권한 체크 세분화.** 지금은 "인증된 사용자면 system user 로 K8s 에 접근" 하는 MVP 수준이다. 실제로는 사용자별로 볼 수 있는 네임스페이스와 리소스가 다르다. UseCase 에 principal 을 전달하고 거기서 허용 여부를 검증하는 구조가 필요하다. `Stream.execute(params, principal)` 로 시그니처 확장이 예상된다.

**웹 터미널 (pod-exec).** 지금의 프로토콜은 서버→클라이언트 단방향 스트림에 맞춰져 있다. 웹 터미널은 입력 (사용자 키 입력) 과 출력 (터미널 응답) 양쪽이 흘러야 한다. 프로토콜에 `send` action 자리를 비워뒀지만, 실제 구현은 `Stream` 인터페이스 확장이냐 별도의 양방향 인터페이스냐 선택이 남는다.

**절대 수명 방어.** FE 가 모든 ping 에 blind 로 pong 을 보내는 극단 케이스에서는 세션 방어 계층 2, 3 이 모두 무력해진다. 구독마다 TTL (예: 1시간) 을 걸어서 최악의 경우에도 결국 정리되도록 하는 선택지를 열어뒀다. 실제 누수 사례가 나오면 넣는 것으로 보류.

**모니터링.** `SubscriptionRegistry.getActiveSubscriptionCount()` 는 있지만 Actuator 로 노출되지는 않았다. Prometheus 게이지로 빼두면 "특정 시점 이후 활성 구독이 이상 증가" 같은 패턴을 알람으로 잡을 수 있다.

## 돌아보며

구축기 내내 느낀 건 **"작은 요구사항 하나가 여러 계층을 바꾼다"** 였다. 다중 구독 하나 추가하니 메시지 포맷, Registry 자료 구조, Handler 디스패치, 테스트 시나리오가 전부 조정돼야 했다. 세션 keep-alive 하나 추가하니 스케줄러 하나, Registry API 하나, 설정 프로퍼티 하나가 새로 들어왔다. WebSocket 을 쓰는 건 REST 서버 하나 더 띄우는 것보다 훨씬 많은 상태 관리를 요구한다.

그 상태 관리를 어디에 맡길 것인가에서 많은 선택이 갈렸다. 자원 회수는 Flow 의 구조적 동시성에, 세션/구독 상태는 Registry 에, 시간 기반 검증은 Scheduler 에 맡겼다. 각자 한 가지만 하게 두는 대신, 그걸 한데 엮는 규약 (`awaitClose`, `CancellationException`, `missedPongs`) 을 분명히 했다. 이 규약이 서로 간섭 없이 같이 돌아갈 때 시스템이 안정적으로 동작한다.

지금 코드가 완벽하지는 않다. FE 구현 규칙에 기대는 지점이 여전히 있고, TTL 같은 최후 안전망도 아직이다. 하지만 "긴 수명의 스트림을 여러 개 다중화하는" 이라는 본질적인 요구에 대해서는, 이 구조가 당분간 확장 가능한 기초로 버텨줄 거라고 본다.
