---
title: Coroutine의 실행 옵션
date: 2025-01-01
tags: [kotlin, coroutine, coroutineStart, lazy, atomic]
order: 10
---

코루틴 빌더의 `start` 매개변수로 실행 방식을 제어할 수 있다. 네 가지 옵션이 있다.

## DEFAULT

기본 옵션으로, 코루틴이 즉시 실행된다. 생성 직후 첫 번째 중단점까지 실행되며, start()를 별도로 호출할 필요가 없다.

```kotlin
fun main() = runBlocking {
    val job = launch(start = CoroutineStart.DEFAULT) {
        println("Default start - Running on ${Thread.currentThread().name}")
    }
    println("Main continues")
    job.join()
}
```

## ATOMIC

코루틴이 취소 불가능한 상태로 시작된다. 첫 번째 중단점 전까지는 반드시 실행되며, 그 이후에만 취소가 가능하다. 중요한 초기화 작업을 보호할 때 유용하다.

```kotlin
fun main() = runBlocking {
    val job = launch(start = CoroutineStart.ATOMIC) {
        println("Atomic start - Running on ${Thread.currentThread().name}")
        delay(1000)
        println("After delay")
    }
    job.cancel()
    job.join()
}

// 출력
// Atomic start - Running on main
```

cancel을 호출했지만 첫 번째 중단점(delay) 이전의 코드는 실행되었다. delay 이후의 "After delay"는 취소되어 출력되지 않는다.

## UNDISPATCHED

코루틴이 즉시 현재 호출자 스레드에서 실행된다. 첫 번째 중단점까지는 현재 스레드에서 실행되고, 이후에는 지정된 디스패처로 제어가 넘어간다. 디스패처 전환의 오버헤드를 줄이고 싶을 때 유용하다.

```kotlin
fun main() = runBlocking {
    val job = launch(start = CoroutineStart.UNDISPATCHED) {
        println("Undispatched start - Running on ${Thread.currentThread().name}")
        delay(1000)
        println("After delay - Dispatcher decides")
    }
    println("Main continues")
    job.join()
}

// 출력
// Undispatched start - Running on main
// Main continues
// After delay - Dispatcher decides
```

## LAZY

코루틴이 지연 생성되며, 명시적으로 시작하기 전까지 실행되지 않는다. `start()`, `join()`, `await()` 같은 메서드를 호출할 때 실행된다. 리소스를 효율적으로 사용하거나 특정 조건에서만 코루틴을 실행하고 싶을 때 적합하다.

```kotlin
fun main() = runBlocking {
    val job = launch(start = CoroutineStart.LAZY) {
        println("Lazy start - Running on ${Thread.currentThread().name}")
    }
    println("Main continues without starting the coroutine")
    job.start()
    job.join()
}

// 출력
// Main continues without starting the coroutine
// Lazy start - Running on main
```

## 비교

| 옵션 | 특징 | 사례 |
|------|------|------|
| DEFAULT | 즉시 실행 | 기본적인 비동기 작업 |
| ATOMIC | 첫 번째 중단점까지 취소 불가능 | 초기화 작업 보호 |
| UNDISPATCHED | 호출자 스레드에서 즉시 실행 | 디스패처 전환 최소화 |
| LAZY | 명시적으로 시작될 때까지 대기 | 리소스 절약, 조건부 실행 |
