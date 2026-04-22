---
title: Channel과 Producer-Consumer 패턴
date: 2026-04-22
tags: [kotlin, coroutine, channel, 백프레셔, producer-consumer]
order: 11
---

Channel은 코루틴 간에 값을 주고받는 suspend 가능한 큐다. 자바의 `BlockingQueue`와 비슷한데, 스레드를 블로킹하는 대신 코루틴을 suspend한다는 점이 다르다.

```kotlin
fun main() = runBlocking {
    val channel = Channel<Int>()

    launch {
        for (i in 1..3) {
            println("send $i")
            channel.send(i)
        }
        channel.close()
    }

    launch {
        for (value in channel) {
            println("receive $value")
            delay(500)
        }
    }
}

// 출력
// send 1
// receive 1
// send 2
// receive 2
// send 3
// receive 3
```

`send`는 값을 큐에 넣고, `receive`는 값을 꺼낸다. 둘 다 suspend 함수여서 버퍼 상태에 따라 코루틴이 잠시 대기할 수 있다.

## 기본 동작

Channel은 3가지 상태를 가진다.

- **버퍼 여유 있음**: send 즉시 성공, receive 즉시 값 획득
- **버퍼 가득 참**: send가 suspend, 누군가 receive로 자리 낼 때까지 대기
- **버퍼 비어 있음**: receive가 suspend, 누군가 send로 값 넣을 때까지 대기

``` mermaid
flowchart TD
    S[send 호출] --> SQ{버퍼 상태?}
    SQ -->|여유 있음| SOK[즉시 큐에 적재]
    SQ -->|가득 참| SW[suspend<br/>자리 날 때까지 대기]

    R[receive 호출] --> RQ{버퍼 상태?}
    RQ -->|값 있음| ROK[즉시 값 반환]
    RQ -->|비어 있음| RW[suspend<br/>값 올 때까지 대기]
    RQ -->|비었고 close됨| RC[루프 종료]
```

`close()`가 호출되면 이후 send는 예외를 던지고, 버퍼에 남은 값은 receive로 모두 꺼낼 수 있다. 이후 receive는 `ClosedReceiveChannelException`을 던진다. `for (item in channel)`은 내부적으로 close 예외를 감지해 루프를 정상 종료한다.

## Capacity 옵션

생성 시 버퍼 크기를 지정할 수 있다.

```kotlin
Channel<Int>()                  // RENDEZVOUS (capacity = 0, 기본)
Channel<Int>(capacity = 100)    // 명시적 버퍼
Channel<Int>(Channel.UNLIMITED) // 무한 버퍼 (메모리 폭주 위험)
Channel<Int>(Channel.CONFLATED) // 최신 값만 유지, 덮어쓰기
```

| 상수 | 의미 | 용도 |
|------|------|------|
| `RENDEZVOUS` | 버퍼 없음, send/receive 둘 다 대기 | 엄격한 동기화 |
| `BUFFERED` | 기본 버퍼(64) | 일반 용도 |
| 명시적 숫자 | 지정 크기 | 메시지 큐 |
| `UNLIMITED` | 무한 | 백프레셔 포기 (권장 X) |
| `CONFLATED` | 최신만 유지 | UI 상태 갱신 |

### 음수 상수는 센티널 값이다

Channel 상수 정의를 보면 음수가 눈에 띈다.

```kotlin
public const val UNLIMITED: Int = Int.MAX_VALUE
public const val RENDEZVOUS: Int = 0
public const val CONFLATED: Int = -1
public const val BUFFERED: Int = -2
```

`CONFLATED`, `BUFFERED`의 음수는 **버퍼 크기 -2가 아니라 "이 모드로 생성해달라"는 센티널 태그**다. 팩토리 함수 `Channel(capacity: Int)`가 음수를 감지해 특수 구현이나 기본 크기로 치환한다.

```kotlin
// 내부 분기 (단순화)
fun <E> Channel(capacity: Int): Channel<E> = when (capacity) {
    RENDEZVOUS -> RendezvousChannel()
    UNLIMITED -> UnlimitedChannel()
    CONFLATED -> ConflatedChannel()
    BUFFERED -> BufferedChannel(capacity = CHANNEL_DEFAULT_CAPACITY) // 64
    else -> BufferedChannel(capacity)   // 양수 그대로
}
```

`BUFFERED`는 실제로는 `CHANNEL_DEFAULT_CAPACITY`(기본 64, JVM 프로퍼티 `kotlinx.coroutines.channels.defaultBuffer`로 조정 가능) 크기의 버퍼가 생성된다. 양수를 넘기면 그 숫자가 버퍼 크기로 그대로 쓰인다.

### 실전에서는 명시적 숫자를 선호

`BUFFERED`로 해도 동작하지만 메시지 큐 용도에서는 명시적 숫자가 낫다.

- **의도가 코드에 드러난다**: `100`이라 써두면 바로 크기를 파악할 수 있다. `BUFFERED`는 내부 상수까지 봐야 64임을 안다.
- **설정 외재화가 쉽다**: Spring 환경이라면 `application.yml`에 값을 빼둘 수 있다. `BUFFERED`는 JVM 시스템 프로퍼티로만 조정 가능해 운영 튜닝이 번거롭다.
- **용도별 최적 크기가 다르다**: 64는 일반 용도 기준값이다. 메시지 큐는 Worker 수 × 10~25 수준이 일반적 출발점이며, 측정 기반으로 조정한다.

## 여러 소비자와 Worker Pool

같은 Channel 하나에 여러 소비자를 붙이면 **한 메시지는 한 소비자에게만** 전달된다. 이 특성을 이용해 Worker Pool을 만들 수 있다.

```kotlin
fun main() = runBlocking {
    val channel = Channel<Int>(capacity = 10)

    launch {
        repeat(10) { channel.send(it) }
        channel.close()
    }

    repeat(4) { workerId ->
        launch {
            for (item in channel) {
                println("Worker-$workerId got $item")
                delay(100)
            }
        }
    }
}
```

Worker 코루틴 4개가 같은 채널에서 경쟁적으로 꺼내 처리한다. 먼저 `receive`를 호출한 코루틴이 값을 가져가므로 **work-stealing**이 자연스럽게 성립한다. 느린 Worker가 있어도 빠른 Worker가 더 많은 메시지를 가져가 처리량이 균형을 찾는다.

``` mermaid
flowchart LR
    P[생산자] -->|send| CH(("Channel<br/>capacity=10"))
    CH -->|receive| W0[Worker-0]
    CH -->|receive| W1[Worker-1]
    CH -->|receive| W2[Worker-2]
    CH -->|receive| W3[Worker-3]
```

Channel은 하나, Worker는 N개. 한 메시지는 단 한 Worker에게만 전달되며, 각 Worker는 독립된 for 루프에서 순차적으로 `receive → processor`를 반복한다. 이 구조가 Worker 수를 "동시 처리 상한"으로 만드는 동시에, 메시지 중복 처리를 자동으로 막아준다.

## 백프레셔

Channel의 capacity 제한은 **생산자가 너무 빠를 때 감속시키는 장치** 역할을 한다.

``` mermaid
flowchart TD
    P[빠른 생산자] -->|send| C{Channel<br/>가득 참?}
    C -->|여유 있음| OK[즉시 적재]
    C -->|가득 참| S[send suspend<br/>생산자 대기]
    S -->|소비자가 receive로<br/>자리 만듦| W[생산자 재개]
    W --> P

    C --> D[느린 소비자<br/>receive]
    D -.처리 완료.-> C
```

생산 속도가 소비 속도에 **자동으로 맞춰진다**. capacity를 무한으로 두지 않는 한 메모리 폭주를 막을 수 있다.

`onBufferOverflow` 옵션으로 가득 찼을 때 동작을 바꿀 수도 있다.

```kotlin
enum class BufferOverflow {
    SUSPEND,      // send가 suspend (기본)
    DROP_OLDEST,  // 오래된 값 버림
    DROP_LATEST,  // 새 값 버림
}
```

유실이 허용되지 않는 메시지 큐 용도에는 `SUSPEND`를 쓴다.

## 일반 스레드에서 호출하기

Channel은 내부적으로 thread-safe 큐로 구현되어 있어 일반 JVM 스레드에서도 `runBlocking`을 감싸면 send/receive를 호출할 수 있다.

```kotlin
// 일반 스레드에서 호출하는 생산자
fun submit(item: Int) {
    runBlocking { channel.send(item) }
}

// 소비자는 코루틴
scope.launch {
    for (item in channel) { process(item) }
}
```

스레드 기반 레거시 콜백(예: Spring `StreamMessageListenerContainer`)과 코루틴 기반 Worker Pool을 연결하는 경계 어댑터로 활용할 수 있다. `runBlocking`이 스레드를 실제 블로킹하기 때문에 버퍼가 가득 차면 스레드 자체가 감속되는 부수 효과가 생기는데, 이게 오히려 백프레셔를 생산자 쪽까지 전달하는 장치가 된다.

``` mermaid
sequenceDiagram
    participant T as JVM 스레드 (생산자)
    participant C as Channel
    participant W as Worker 코루틴

    T->>C: runBlocking { send(item) }
    Note over T,C: 버퍼 여유 → 즉시 반환
    T->>T: 다음 작업 진행

    W->>C: receive()
    C-->>W: item
    W->>W: processor(item) 실행

    Note over T,C: 버퍼 가득 → send가 suspend
    T->>C: runBlocking { send(item) }
    Note over T: 스레드가 실제 블로킹<br/>(상위 polling 감속)
    W->>C: receive() (자리 확보)
    C-->>T: 생산자 재개
```

## 참고

- [Channels - Kotlin Docs](https://kotlinlang.org/docs/channels.html)
- [kotlinx.coroutines Channel API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.channels/-channel/)
