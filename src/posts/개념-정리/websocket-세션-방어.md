---
title: 세션 방어 3계층
date: 2026-04-23
tags: [websocket, heartbeat, timeout, keep-alive]
series: 실시간 로그 스트리밍 구축기
seriesOrder: 5
---

긴 수명의 WebSocket 연결에는 "어떻게 끝내는가" 가 중요한 문제다. 정상 종료는 쉽다. 어려운 건 **FE 가 끝났다는 걸 서버가 모르는 상황** 이다.

- 탭을 강제로 닫음. Close 프레임이 도달하지 못함
- 브라우저 크래시, 네트워크 단절
- FE 코드 버그로 unsubscribe 를 못 보냄
- FE 가 화면을 떠났는데 연결은 살아있음

이런 경우 K8s LogWatch 는 열려 있고, 구독 Job 은 돌고 있고, 서버 메모리는 계속 데이터를 쏟아내고 있다. 누구도 받지 않는다. 이걸 자동으로 감지하고 정리하는 장치가 필요하다.

이 프로젝트는 세 계층의 방어를 걸었다. 각 계층이 서로 다른 실패 모드를 커버한다.

## 계층 1 — Tomcat idle timeout

가장 바깥에 있는 최후 방어선이다. `ServletServerContainerFactoryBean` 의 `maxSessionIdleTimeout` 을 60초로 설정하면, **60초 동안 incoming 프레임이 하나도 없으면** Tomcat 이 세션을 강제로 닫고 `afterConnectionClosed` 를 발동시킨다.

한 가지 주의점이 있다. Tomcat 의 idle 판정은 **incoming 기준** 이다. 서버가 보내는 프레임만 있고 클라이언트로부터 아무것도 안 돌아오면 결국 타임아웃에 걸린다. 이 특성 덕분에 "클라이언트가 정말 죽었는지" 를 판별할 수 있다. 반대로 outgoing 만으로는 리셋이 안 되니까, 서버가 ping 을 계속 보내도 pong 이 안 오면 결국 60초 뒤 끊긴다.

이것만으로는 부족하다. 두 가지 한계가 있다.

- **60초는 길다**. 구독이 이미 좀비 상태면 60초 동안 K8s 로그를 계속 받아오고 있다
- **연결 레벨 감지에 불과하다**. 같은 연결 안에서 한 구독은 좀비가 돼도 다른 구독이 pong 을 잘 보내면 연결은 살아있고, 좀비 구독만 남아있는 상황이 감지 안 된다

이 두 한계를 각각 계층 2, 3 이 보완한다.

## 계층 2 — 구독 레벨 heartbeat

서버가 각 **구독** 에 대해 주기적으로 `ping` 을 보낸다. FE 는 해당 구독이 살아있으면 `pong` 으로 응답한다. 2회 연속 pong 이 안 오면 구독을 강제 cancel.

핵심은 "구독 레벨" 이라는 것이다. 같은 세션의 다른 구독은 영향을 받지 않는다. FE 의 **특정 화면** 이 죽었는지를 추적하는 도구다.

```kotlin
@Scheduled(fixedRateString = "\${ccp.websocket.heartbeat-interval-ms:30000}")
fun heartbeat() {
  val alive = subscriptionRegistry.tickHeartbeat(maxMissed = maxMissedPongs)
  alive.forEach { info ->
    sessionRegistry.send(info.sessionId, OutboundMessage(info.subscriptionId, "ping"))
  }
}
```

`tickHeartbeat` 안에서 한 번에 두 가지를 한다. `missedPongs` 가 임계를 넘은 구독은 cancel 하고 Registry 에서 제거, 살아있는 구독은 `missedPongs++` 로 카운터를 올린다. FE 가 pong 을 보내면 Handler 에서 `resetMissedPongs` 로 0 으로 되돌린다.

이 메커니즘이 제대로 돌려면 **FE 가 올바르게 구현** 되어 있어야 한다. FE 가 모든 ping 에 blind 로 pong 을 보내면 (예: 언마운트된 구독의 ping 에도 자동 응답) 계층 2는 무력해진다. 이건 FE 협의 사항이다.

현재 설정 기준 (30초 주기, 2회 허용) 으로 좀비 구독은 **최대 90초 안에** 정리된다.

| 시각 | missedPongs | 동작 |
|------|-------------|------|
| t=0s | 0 | 구독 시작 |
| t=30s | 0 → 1 | 1차 ping 전송 |
| t=60s | 1 → 2 | 2차 ping 전송 |
| t=90s | 2 ≥ 임계 | 구독 제거 + Job cancel |

## 계층 3 — 세션 레벨 keep-alive

계층 2가 "구독 좀비" 를 잡지만, 또 다른 실패 모드가 있다. **세션에 구독이 하나도 없는 상태** 다. FE 가 페이지 진입 시 subscribe, 이탈 시 unsubscribe 를 정상 수행하면, 화면 사이 잠깐 구독이 0이 되는 순간이 있다.

계층 2의 heartbeat 는 "구독이 있을 때만" 동작한다. 구독 0이면 ping 이 안 나가고, 프레임 트래픽이 0이 되니까 계층 1의 idle timeout 60초에 걸려 **연결이 죽는다**. FE 가 다음 화면에서 subscribe 하려는데 연결이 없어져서 재연결부터 다시 시작해야 한다.

세션 자체를 살아있게 하는 별도 장치가 필요하다.

```kotlin
@Scheduled(fixedRateString = "\${ccp.websocket.session-keepalive-interval-ms:30000}")
fun keepAlive() {
  sessionRegistry.allSessions().filter { it.isOpen }.forEach { session ->
    runCatching {
      synchronized(session) { session.sendMessage(PingMessage()) }
    }
  }
}
```

WebSocket 프로토콜의 **제어 프레임** `PingMessage` 를 보낸다. 계층 2의 JSON ping 이 아니라 프로토콜 레벨이다. 브라우저 (그리고 RFC 6455 를 지키는 모든 WebSocket 클라이언트) 는 이 프레임을 받으면 **자동으로 `PongMessage` 로 응답** 한다. 애플리케이션 코드가 개입하지 않는다.

이 Pong 이 들어오면 Tomcat idle timer 가 리셋된다. 결과적으로 **구독이 0개여도 연결이 유지** 된다.

반대로 네트워크가 끊겼거나 브라우저가 진짜 죽은 상황이면 Pong 이 안 돌아오고, 계층 1의 idle timeout 이 결국 세션을 정리한다.

## 세 계층의 역할 분담

| 실패 모드 | 계층 1 (idle timeout) | 계층 2 (구독 ping/pong) | 계층 3 (세션 PING) |
|-----------|-----------------------|-------------------------|--------------------|
| 네트워크 단절, 브라우저 크래시 | 60초 내 감지 | — | Pong 안 옴 → 결국 계층 1 이 정리 |
| FE 화면 좀비 (연결 살아있음) | — | 60~90초 내 구독 cancel | — |
| 구독 없는 유휴 세션 | 계층 3 가 없으면 60초에 끊김 | — | 30초마다 Ping 으로 유지 |
| FE 가 unsubscribe 안 보냄 | — | pong 중단 시 정리 | — |

계층별로 커버하는 지점이 다르다. 하나만으로는 부족하고, 세 개가 맞물려야 안정적으로 돌아간다. 특히 계층 2와 3은 **서로를 대체하지 않는다**. 둘 다 필요하다.

## 파라미터 튜닝

세 계층의 주기는 `application.yml` 로 외부화했다.

```yaml
ccp:
  websocket:
    max-session-idle-timeout-ms: 60000        # 계층 1
    session-keepalive-interval-ms: 30000      # 계층 3
    heartbeat-interval-ms: 30000              # 계층 2
    max-missed-pongs: 2                       # 계층 2
```

**session-keepalive-interval-ms 는 idle-timeout 의 절반 이하** 로 두는 게 원칙이다. Pong 이 한 번 실패해도 다음 주기가 idle timeout 이 발동하기 전에 도달해야 리셋이 걸린다. 30s ≤ 60s/2 라 안전하다.

**max-missed-pongs 는 네트워크 지터를 흡수할 만큼** 여유가 있어야 한다. 1로 줄이면 일시적인 네트워크 깜빡임에도 구독이 끊길 수 있다. 2가 무난한 기본값이다.

좀비 감지 시간을 더 빠르게 하고 싶으면 heartbeat-interval 을 줄이면 된다. 10초 주기 + 2회 허용이면 30초 이내에 좀비가 정리된다. 단 주기가 짧아질수록 정상 세션의 프레임 트래픽이 늘어난다.

## 끝내 잡히지 않는 것

이 3계층으로도 완전히 못 잡는 상황이 있다. FE 가 **모든 ping 에 blind 로 pong 을 반환** 하는 경우다. 이러면 구독이 좀비(화면 언마운트) 여도 pong 이 계속 돌아오니 계층 2가 발동 안 하고, 세션도 살아있으니 계층 1도 발동 안 한다. K8s LogWatch 가 무한정 열려 있다.

이건 본질적으로 FE 구현 규칙의 문제라 서버만으로는 해결이 안 된다. FE 가 **활성 구독 핸들러의 ping 에만 pong 을 응답** 하는 규약이 같이 서야 한다. 정말 서버 측에서도 최후의 안전망을 걸고 싶다면 구독별 절대 수명 (TTL) 을 주는 방법이 있는데, 이 프로젝트에서는 아직 도입 안 했다. 실제 운영에서 장기 누수 사례가 나오면 그때 넣어도 늦지 않다.
