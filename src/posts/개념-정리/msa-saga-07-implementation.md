---
title: "MSA Saga 여정 (7) — Stream 구성, 코드 구조, 브로커 안전망"
date: 2026-04-12
tags: [saga, outbox, redis-stream, consumer-group, msa]
series: MSA Saga 여정
seriesOrder: 7
---

## 1. Stream(토픽) 구성 옵션

### 베스트 프랙티스

Chris Richardson / Eventuate Tram에서는 **서비스당 Command 채널 1개**를 권장한다. Step당 Stream은 **Anti-pattern**이다.

### 3가지 옵션 비교

| | Saga 단위 | Step 단위 | 서비스 단위 (권장) |
|--|-----------|---------|--------------------|
| Stream 수 | Saga 수만큼 | 폭증 | 서비스 수만큼 (적음) |
| 내부 분기 | stepType 1단계 | 불필요 | sagaType + stepType 2단계 |
| MSA 전환 | 재설계 필요 | 결합도 높음 | 그대로 사용 |

Step별 Stream이면 Saga 하나에 보상까지 포함해서 Stream 6개, Saga 10개면 60개로 관리 지옥이 된다.

### 서비스 단위 Stream의 내부 분기

서비스 단위로 묶으면 2단계 분기(sagaType → stepType)가 필요하다.

``` text
Stream: payment-service-commands
  │
  ├─ sagaType = order:create
  │    ├─ stepType = PAYMENT_REQUEST
  │    └─ stepType = PAYMENT_CANCEL
  │
  └─ sagaType = order:refund
       └─ stepType = REFUND_REQUEST
```

어차피 내부 분기는 필요하다. Stream을 어떤 단위로 묶느냐의 차이다.

---

## 2. 코드 구조 옵션

### A. 하나의 Consumer + when문

```kotlin
@StreamListener(stream = "order-saga")
fun onOrderSaga(event: OrderSagaEvent) {
    when (event.stepType) {
        PAYMENT_REQUEST -> { ... }
        INVENTORY_REQUEST -> { ... }
    }
}
```

- 장점: 단순, 한 파일에서 전체 흐름 보임
- 단점: Step 많아지면 비대, payload 타입 하나에 몰림

### B. StepHandler + Router

```kotlin
interface SagaStepHandler<T> {
    val stepType: String
    fun handle(sagaId: UUID, payload: T): StepResult
    fun compensate(sagaId: UUID, payload: T)
}
```

- 장점: Step별 완전 분리, 타입 안전, 테스트 쉬움
- 단점: 클래스 많아짐, 간접 레이어 추가

### C. Consumer + Step별 메서드 (컨트롤러 스타일)

```kotlin
@StreamListener(stream = "order-saga", step = "PAYMENT_REQUEST")
fun onPaymentRequest(payload: PaymentRequestPayload) {
    paymentRequestUseCase.execute(payload)
}
```

- 장점: 컨트롤러 패턴과 일관성, when문 없음, payload 타입 안전
- 단점: 어노테이션 + Registrar 커스텀 필요

### 코드 구조와 흐름 제어 패턴은 별개다

A, B, C 세 방식 모두 각 Step이 다음 Step을 알고 있다면 코레오그래피고, 오케스트레이터가 결정한다면 오케스트레이션이다. 코드 구조와 흐름 제어 패턴은 독립적이다.

### 공통 원칙: Consumer에서 비즈니스 로직 분리

어떤 구조든 핵심은 같다.

``` text
Consumer → InPort → UseCase → OutPort (발행)
```

- Consumer: 메시지 수신 + InPort 호출만 (얇게)
- UseCase: 비즈니스 로직 + 다음 Step 결정 + OutPort 호출
- OutPort: Outbox INSERT, Saga State UPDATE

---

## 3. Step별 메서드 방식의 함정과 해결

### 문제: Stream당 Subscription이 여러 개 생긴다

C번 방식(Step별 메서드)을 적용하면 같은 stream에 어노테이션이 3개 붙을 수 있다. Registrar가 각 어노테이션마다 `container.receive()`를 호출하면 **Subscription이 3개** 생긴다.

같은 (stream, consumerGroup, consumerName)으로 Subscription이 여러 개면, 각 Subscription이 독립적으로 `XREADGROUP`을 호출한다. 메시지 브로커는 같은 consumer에게 중복 전달하지 않으므로 메시지가 **랜덤으로 1개 Subscription에만** 간다. 결과적으로 step이 `PAYMENT_REQUEST`인 메시지가 `onInventoryRequest()` 구독에 들어갈 수 있다.

### 해결: Stream당 Subscription 1개 + 내부 라우팅

Stream당 Subscription을 1개만 등록하고, 내부에서 (sagaType + step) → 메서드로 라우팅하면 된다.

``` text
메시지 도착: {sagaType: "order:create", step: "PAYMENT_SUCCESS", payload: {...}}
    │
    └─ Subscription 1개에서 수신 (stream당 1개만 등록)
         │
         매핑 테이블 조회: (sagaType + step) → 메서드
         │
         └─ onPaymentSuccess() 호출 → 정상
```

Registrar가 서버 시작 시 어노테이션을 스캔해서 매핑 테이블을 만들고, 메시지 수신 시 stepType으로 메서드를 찾아 호출하는 구조다.

```kotlin
val listenersByStream = listenerInfos.groupBy { it.stream }

listenersByStream.forEach { (stream, infos) ->
    val stepMap = infos.associateBy { Pair(it.sagaType, it.step) }

    container.receive(
        Consumer.from(consumerGroup, consumerName),
        StreamOffset.create(stream, ReadOffset.lastConsumed()),
    ) { record ->
        val sagaType = extractSagaType(record)
        val step = extractStep(record)
        val info = stepMap[Pair(sagaType, step)]
        info?.let { handleMessage(it, record) }
            ?: logger.warn { "Unknown: sagaType=$sagaType, step=$step" }
    }
}
```

### 1서비스 = 1 Stream = 1 Consumer Group

"서비스당 Command 채널 1개"가 베스트 프랙티스이고, Consumer Group도 서비스당 1개가 기본이다.

| Consumer Group 여러 개 | Consumer Group 1개 |
|--|--|
| 같은 메시지가 각 그룹마다 전달됨 (브로드캐스트) | 메시지가 그룹 내 consumer 1개에만 전달됨 (로드밸런싱) |

Consumer Group이 여러 개 필요한 건 **서로 다른 서비스**가 같은 stream을 구독할 때다. 같은 서비스 안에서 sagaType/step별로 나누는 건 내부 라우팅으로 풀어야 한다.

### Consumer가 곧 오케스트레이터

이 구조에서는 별도 오케스트레이터 컴포넌트, 흐름 정의 DSL, 라우터 전부 필요 없다. Consumer 클래스 자체가 오케스트레이터 역할을 한다.

```kotlin
// sagaType 단위 클래스 = 오케스트레이터
@SagaConsumer(sagaType = "order:create")
class OrderCreateConsumer {

    @StepHandler("PAYMENT_SUCCESS")
    fun onPaymentSuccess(payload: PaymentResult) {
        inventoryRequestUseCase.execute(...)  // 다음 Step 실행
    }

    @StepHandler("INVENTORY_SUCCESS")
    fun onInventorySuccess(payload: InventoryResult) {
        shippingRequestUseCase.execute(...)
    }
}
```

핵심은 UseCase가 다음 Step을 발행하는 게 아니라, **UseCase는 결과만 발행하고 Consumer가 결과를 수신해서 다음 UseCase를 호출**한다는 점이다.

``` text
X UseCase가 다음 step 발행 (코레오그래피)
   paymentUseCase: "결제 성공했으니 INVENTORY_REQUEST 이벤트 발행할게"

O UseCase는 결과만 발행 (오케스트레이션)
   paymentUseCase: "결제 성공했어" (PAYMENT_SUCCESS 발행)
   Consumer: SUCCESS 수신 → inventoryRequestUseCase.execute()
```

이 클래스를 보면 해당 Saga의 전체 흐름이 한눈에 보인다.

### 기존 아키텍처와의 일관성

진입점만 바뀌고 이후 흐름은 동일하다.

``` text
REST 요청 흐름:
Controller → InPort → UseCase → OutPort

Saga 결과 수신 흐름:
@StepHandler 메서드 → InPort → UseCase → OutPort
```

별도 컴포넌트 없이 컨트롤러처럼 자연스럽게 흐르는 오케스트레이션 구조다.

---

## 4. Stream 통합 시 블로킹 문제

### 브로커 레벨: 문제없다

Stream을 하나로 합치면 특정 Saga가 느려질 때 다른 Saga도 영향받지 않을까 걱정할 수 있다. 하지만 브로커 레벨에서는 문제가 없다.

- `XADD` (메시지 추가): O(1), stream 개수와 무관
- `XREADGROUP` (메시지 읽기): O(1), consumer group 개수와 무관
- 인메모리라 stream 분리가 성능에 영향을 주지 않음

Kafka도 마찬가지다. 성능은 토픽 수가 아니라 **파티션 수 + consumer 수**로 결정된다. stream을 나누는 이유는 브로커 성능이 아니라 **논리적 분리**를 위한 것이다.

### Consumer 처리 레벨: 여기가 문제

`StreamMessageListenerContainer`는 기본적으로 **동기 처리**다. 폴링 루프에서 메시지를 가져오고 → 콜백 호출 → 끝나면 다음 메시지. stream마다 Subscription이 따로 있으면 서로 영향 없지만, 1 stream으로 통합하면 Subscription이 1개가 되므로 하나가 느리면 뒤가 밀린다.

### 해결: 비동기 처리 (스레드풀 위임)

```kotlin
container.receive(...) { record ->
    // 메시지 수신 즉시 스레드풀에 위임, 폴링 루프는 바로 다음 메시지로
    taskExecutor.submit {
        val (sagaType, step) = extract(record)
        stepMap[Pair(sagaType, step)]?.handle(record)
    }
}
```

메시지 수신은 단일 폴링 루프지만, 실제 처리는 스레드풀에서 병렬로 돌린다. 하나가 30초 걸려도 다른 메시지는 바로 처리된다.

### 스케일 아웃과 조합

```
Consumer Group: order-service-group
  ├─ consumer-1 (인스턴스1, 스레드풀 10개) → 동시 10개 처리
  └─ consumer-2 (인스턴스2, 스레드풀 10개) → 동시 10개 처리
  = 총 동시 처리 20개
```

인스턴스가 여러 개면 브로커가 consumer끼리 메시지를 분배하고, 각 인스턴스 내부에서는 스레드풀로 병렬 처리한다. **병목은 stream 개수가 아니라 consumer 처리 능력**으로 풀어야 한다.

---

## 5. 메시지 브로커와 안전망

### 서버 다운 시 PEL 문제

처리 결과 무관하게 finally에서 무조건 ACK하는 방식에서, 서버가 다운되면 finally가 실행되지 않아 ACK가 안 되고 PEL(Pending Entry List)에 남는다.

서버 재시작 시 `ReadOffset.lastConsumed()`로 새 메시지만 읽기 시작하기 때문에, PEL에 남은 미ACK 메시지를 `XPENDING → XCLAIM`으로 다시 가져오는 로직이 없으면 그 메시지는 묻힌다.

하지만 Saga 타임아웃이 이를 커버한다. PEL 재처리기를 서버 시작 시 추가하면 더 안전하지만 필수는 아니다.

### 메모리 기반 브로커의 유실 가능성

Kafka는 offset 기반이라 메시지가 디스크에 남지만, Valkey(Redis) Stream은 메모리 기반이다. 브로커 자체가 죽으면 메시지 유실이 가능하다. 그래서 **Outbox 테이블이 더 중요**하고, **Saga 타임아웃이 최종 안전망**이다.

Outbox에 원본이 남아있으니 브로커가 죽어도 재발행이 가능하고, Saga 타임아웃이 응답 없음을 감지해서 재시도를 트리거한다. 결국 브로커 의존도를 낮추고 DB를 신뢰의 원천(source of truth)으로 삼는 구조다.
