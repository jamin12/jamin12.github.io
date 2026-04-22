---
title: Flow와 Cold Stream
date: 2026-04-22
tags: [kotlin, coroutine, flow, callbackFlow, cold-stream]
order: 12
---

Flow는 **비동기로 값을 여러 개 차례로 내보내는 스트림**이다. 함수가 값을 하나 반환한다면, Flow는 시간에 걸쳐 값을 여러 개 뱉어낸다.

```kotlin
fun main() = runBlocking {
    val numbers: Flow<Int> = flow {
        emit(1)
        delay(100)
        emit(2)
        delay(100)
        emit(3)
    }

    numbers.collect { value ->
        println("received $value")
    }
}

// 출력
// received 1
// received 2
// received 3
```

두 역할이 전부다.

- **생산자 (`emit`)**: `flow { ... }` 블록 안에서 값을 내보낸다.
- **소비자 (`collect`)**: `.collect { }`로 값을 받는다.

## 왜 필요한가

함수와 비교해서 보면 빈자리가 보인다.

| 반환 스타일 | 값 개수 | 비동기 |
|---|---|---|
| `fun(): Int` | 1 | X |
| `fun(): List<Int>` | N | X |
| `suspend fun(): Int` | 1 | O |
| **`Flow<Int>`** | **N** | **O** |

"여러 값 + 비동기"의 빈칸이 Flow다. Pod 로그처럼 **실시간으로 계속 들어오는 값**이나, DB에서 수백만 row를 **스트리밍으로 처리**할 때 Flow가 자연스럽다.

## Cold Stream

Flow의 핵심 성질은 "cold"다.

> `collect`가 호출될 때마다 `flow { }` 블록이 **처음부터 다시 실행된다.**

```kotlin
val source = flow {
    println("flow 시작")
    emit(1)
    emit(2)
}

runBlocking {
    source.collect { println("A: $it") }
    println("-----")
    source.collect { println("B: $it") }
}

// 출력
// flow 시작        ← 첫 번째 collect
// A: 1
// A: 2
// -----
// flow 시작        ← 두 번째 collect에서 또!
// B: 1
// B: 2
```

수집할 때마다 처음부터. 수집자가 없으면 아무 코드도 실행되지 않는다. 이 특성 덕에 **리소스 생명주기가 수집자와 자동으로 매칭**된다.

## 연산자 체인

Flow는 중간 연산자(intermediate)와 터미널 연산자(terminal)로 구성된다.

```kotlin
flow {
    for (i in 1..100) emit(i)
}
  .filter { it % 2 == 0 }   // 짝수만 — 중간
  .map { it * it }           // 제곱 — 중간
  .take(3)                   // 앞 3개 — 중간
  .collect { println(it) }   // 소비 — 터미널
```

**터미널 연산자가 호출돼야 비로소 Flow가 실행된다.** 중간 연산자만 붙여두면 아무 일도 안 일어난다.

자주 쓰는 터미널 연산자:

| 연산자 | 역할 |
|---|---|
| `collect { }` | 각 값마다 람다 실행 |
| `collectLatest { }` | 새 값 오면 이전 람다 취소하고 재시작 |
| `toList()` / `toSet()` | 자료구조로 모음 |
| `first()` / `firstOrNull()` | 첫 값만 |
| `count()` / `reduce` / `fold` | 집계 |
| `launchIn(scope)` | 별도 코루틴에서 실행, Job 반환 |

## 백프레셔는 공짜

`emit`이 suspend 함수다. 소비자가 느리면 emit 자체가 자연스럽게 대기한다.

```kotlin
flow {
    emit(1)  // collect가 받아갈 때까지 여기서 suspend
    emit(2)
}
```

별도 버퍼 정책이나 백프레셔 전략이 필요 없다. "느린 소비자가 생산자를 자동으로 감속시키는" 구조가 기본값이다.

## buffer — 생산자와 소비자 분리

기본 Flow는 같은 코루틴에서 순차 실행이라, 생산 300ms + 소비 700ms = 한 아이템당 1000ms 걸린다. `buffer()` 중간 연산자를 끼우면 둘이 **병렬 실행**된다.

```kotlin
flow {
    repeat(3) {
        delay(300)
        emit(it)
    }
}
.buffer(capacity = 10)
.collect {
    delay(700)
    process(it)
}
```

``` mermaid
flowchart LR
    F[flow 블록] -->|emit| B[(buffer<br/>내부 Channel)]
    B -->|receive| C[collect 블록]
```

`buffer` 내부에는 **Channel**이 들어간다. 그래서 `capacity`, `onBufferOverflow` 같은 옵션이 Channel과 똑같다. Flow의 순차 모델에 Channel이라는 비동기 버퍼를 끼워넣어 병렬 구간을 만드는 구조다.

관련 연산자:

| 연산자 | 역할 |
|---|---|
| `buffer(n)` | 버퍼 n개, 병렬성 분리 |
| `conflate()` | 느린 소비자를 만나면 중간 값 버리고 최신만 유지 |
| `flowOn(dispatcher)` | 업스트림을 다른 디스패처에서 실행 (내부에 buffer 포함) |
| `collectLatest { }` | 새 값 오면 진행 중인 collect 블록 취소 |

## callbackFlow — 외부 콜백을 Flow로

`flow { }`는 내가 블록 안에서 **직접 emit**하는 경우에 쓴다. 하지만 값이 외부에서 들어오는 경우 — 센서 리스너, WebSocket, 파일 watcher, 블로킹 I/O 스트림 등 — 에는 다른 빌더가 필요하다. `emit`이 suspend 함수라 콜백 람다 안에서 호출할 수 없고, 값을 다른 스레드에서 던져주는 경우 thread-safe 전달이 필요하기 때문이다.

`callbackFlow { }`가 그 어댑터 역할을 한다.

```kotlin
fun sensorEvents(): Flow<Int> = callbackFlow {
    val listener = object : SensorListener {
        override fun onValue(v: Int) = trySend(v).let { }
    }
    sensor.register(listener)

    awaitClose {
        sensor.unregister(listener)
    }
}
```

두 가지 특징이 있다.

- **`trySend` / `send`**: 일반 함수라 콜백/다른 스레드 어디에서든 호출 가능 (내부에 Channel이 있어 thread-safe).
- **`awaitClose { }` 필수**: 블록이 바로 끝나면 콜백이 와도 받을 곳이 없으니, 수집자가 취소할 때까지 블록을 대기시키면서 cleanup 코드를 등록한다.

### `flow { }` vs `callbackFlow { }`

| | `flow { }` | `callbackFlow { }` |
|---|---|---|
| 값의 출처 | 블록 내부 (pull) | 외부 콜백/리스너 (push) |
| 방출 API | `emit()` (suspend) | `trySend()` / `send()` |
| Thread-safety | 같은 코루틴에서만 | 어느 스레드에서든 |
| 내부 구현 | 단순 suspend 블록 | Channel 기반 |
| 종료 | 블록 끝나면 자동 | `close()` + `awaitClose` |
| 용도 | 순차적 값 생성 | 콜백·이벤트·I/O 래핑 |

## awaitClose가 필요한 이유

`callbackFlow`에서 `awaitClose`가 없으면 런타임 에러가 난다. 언어 차원에서 강제하는 이유는 간단하다.

``` mermaid
flowchart TD
    A[callbackFlow 블록 시작] --> B[리스너 등록 /<br/>로그 스트림 열기]
    B --> C{awaitClose 있음?}
    C -->|없음| D[블록 즉시 종료<br/>콜백 와도 못 받음<br/>리소스 누수]
    C -->|있음| E[수집자가 그만둘 때까지<br/>suspend 상태 유지]
    E -->|취소/close| F[awaitClose 블록 실행<br/>리스너 해제 / 리소스 close]
```

`awaitClose`는 두 가지를 동시에 한다.

1. **블록을 suspend 상태로 유지** — 리스너가 살아있는 동안 블록이 끝나지 않도록.
2. **close 시점의 cleanup 훅** — 수집자가 취소되거나 에러가 나면 반드시 실행.

Flow 세계의 `try-finally`이자, 외부 리소스 누수 방지 장치다.

## Flow vs Channel

둘 다 비동기 스트림을 다루지만 모델이 다르다.

| 특징 | Channel | Flow |
|---|---|---|
| 타입 | hot | cold |
| 값의 생산 | `send`하는 순간 생성 | `collect`할 때 비로소 생산 시작 |
| 소비자 없으면? | 값이 쌓이거나 대기 | 아무 코드도 실행 안 됨 |
| 소비자 여럿? | 한 값 = 한 소비자 (경쟁) | 각자 독립적으로 처음부터 재실행 |
| 용도 | 작업 큐, 메시지 전달 | 데이터 변환 파이프라인, 이벤트 스트림 |

라이브 방송(Channel)과 녹화 영상(Flow)의 차이로 이해하면 쉽다. Channel은 방송 중 시점부터만 받고, Flow는 재생 버튼 누를 때마다 처음부터 재생된다.

재밌는 사실은 **Channel이 Flow의 내부 구현 재료**이기도 하다는 것. `callbackFlow`나 `buffer()`가 내부에서 Channel을 쓴다. 둘은 경쟁이 아니라 **추상화 층이 다른 협력 관계**다.

## 소비는 보통 scope.launch 안에서

실무에선 `collect`를 단독으로 부르기보다 코루틴 스코프 안에서 launch하는 경우가 많다.

```kotlin
scope.launch {
    try {
        flow.collect { payload -> handle(payload) }
    } catch (_: CancellationException) {
        // 정상 취소
    } catch (e: Exception) {
        // 에러 처리
    }
}
```

이유는 세 가지다.

- `collect`가 suspend 함수라 코루틴 컨텍스트가 필요하다.
- **호출자와 분리** — Flow가 오래 걸려도 호출 흐름이 막히지 않는다.
- **수명주기 매핑** — scope 취소 시 수집과 리소스(callbackFlow의 `awaitClose`)까지 연쇄 정리된다.

Scope를 세션이나 리소스 생명주기에 묶어두면, **세션 끊길 때 Flow 수집이 자동 취소 → `awaitClose` 실행 → 외부 리소스 정리**까지 한 번에 일어난다. Kotlin 코루틴의 structured concurrency가 주는 가장 큰 이점 중 하나다.

## 참고

- [Asynchronous Flow - Kotlin Docs](https://kotlinlang.org/docs/flow.html)
- [kotlinx.coroutines Flow API](https://kotlinlang.org/api/kotlinx.coroutines/kotlinx-coroutines-core/kotlinx.coroutines.flow/)
