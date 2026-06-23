---
title: suspend 함수
date: 2024-12-27
tags: [kotlin, coroutine, suspend, continuation]
order: 8
---

suspend 함수는 코루틴 내에서만 호출할 수 있는 특수한 함수다. 실행 중 특정 시점에서 중단되었다가 필요할 때 다시 재개할 수 있다.

핵심 특징은 네 가지다. 첫째, 특정 조건에서 중단될 수 있으며 이후 다시 재개된다. 둘째, 호출될 때 코루틴의 컨텍스트에서 실행된다. 셋째, 중단된 뒤 다시 실행될 때 같은 스레드가 아니라 다른 스레드에서 실행될 수 있다. 넷째, 콜백 지옥을 피하고 비동기 코드를 동기 코드처럼 작성할 수 있다.

```kotlin
suspend fun example(st: String) {
    println("작업 시작 $st - ${Thread.currentThread().name}")
    delay(1000)
    println("작업 재개 $st - ${Thread.currentThread().name}")
}

fun main(): Unit = runBlocking {
    launch(Dispatchers.IO) { example("qwer1") }
    launch(Dispatchers.IO) { example("qwer2") }
    launch(Dispatchers.IO) { example("qwer3") }
    launch(Dispatchers.IO) { example("qwer4") }
    launch(Dispatchers.IO) { example("qwer5") }
}
```

실행해보면 작업이 재개되었을 때 시작할 때와 다른 스레드에서 실행되는 경우를 볼 수 있다. suspend 함수는 스레드를 블로킹하지 않기 때문에 중단된 동안 다른 작업이 그 스레드를 활용할 수 있다.

## 동작 원리

### Continuation 인터페이스

suspend 함수는 컴파일 시 `Continuation<T>`라는 인터페이스를 이용해 상태를 관리하도록 변환된다. 함수의 호출 상태를 저장하고 재개 시 이전 상태를 복원한다.

### 스택리스 설계

코루틴은 스택을 사용하지 않는 구조로 설계되어 있다. suspend 함수가 내부적으로 다른 suspend 함수를 호출해도 호출 스택이 깊어지는 방식으로 동작하지 않는다. 대신 각 함수는 상태 머신으로 변환되어 호출 상태를 저장하고 재개될 수 있도록 관리된다.

```kotlin
suspend fun functionA() {
    println("A 시작")
    functionB()
    println("A 종료")
}

suspend fun functionB() {
    println("B 시작")
    delay(1000)
    println("B 종료")
}
```

이 코드가 컴파일되면 대략 이런 구조의 상태 머신으로 변환된다.

```kotlin
class FunctionAContinuation : Continuation<Unit> {
    var state = 0
    override fun resumeWith(result: Result<Unit>) {
        when (state) {
            0 -> {
                println("A 시작")
                state = 1
                FunctionBContinuation().resumeWith(Result.success(Unit))
            }
            1 -> {
                println("A 종료")
            }
        }
    }
}

class FunctionBContinuation : Continuation<Unit> {
    var state = 0
    override fun resumeWith(result: Result<Unit>) {
        when (state) {
            0 -> {
                println("B 시작")
                state = 1
                delay(1000, this) // 중단
            }
            1 -> {
                println("B 종료")
            }
        }
    }
}
```

호출 스택으로 쌓이지 않고, 기존 호출이 제거되고 상태를 저장하는 방식이다.

## 참고

- [Suspend functions - Kotlin (Android Developers)](https://www.youtube.com/watch?v=IQf-vtIC-Uc)
