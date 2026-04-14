---
title: Dispatcher
date: 2024-12-07
tags: [kotlin, coroutine, dispatcher, 스레드-풀]
order: 2
---

Dispatcher는 코루틴이 실행될 스레드나 스레드 풀을 제어한다. UI 업데이트, 네트워크 요청, 데이터베이스 작업 등을 적합한 스레드에서 효율적으로 실행할 수 있게 해주는 역할이다.

## 스레드 풀 공유

Dispatchers.IO와 Dispatchers.Default는 공유 스레드 풀을 기반으로 동작한다. JVM 전역적으로 관리되며 여러 디스패처가 효율적으로 자원을 공유할 수 있게 설계되어 있다.

- **IO 스레드 풀**: 네트워크 요청, 파일 입출력 등에 최적화되어 있고, 스레드 수가 작업량에 따라 동적으로 증가한다.
- **Default 스레드 풀**: CPU 집약적인 작업을 위해 CPU 코어 수에 맞게 최적화되어 있다.

실제로 확인해보면 IO와 Default가 같은 스레드 풀을 사용하고 있는 것을 볼 수 있다.

```kotlin
fun main() = runBlocking<Unit> {
    launch(Dispatchers.IO) {
        launch { println("${Thread.currentThread().name} - IO 1") }
        launch { println("${Thread.currentThread().name} - IO 2") }
        launch { println("${Thread.currentThread().name} - IO 3") }
    }
}

// 출력
// DefaultDispatcher-worker-3 @coroutine#3 - IO 1
// DefaultDispatcher-worker-3 @coroutine#4 - IO 2
// DefaultDispatcher-worker-1 @coroutine#5 - IO 3
```

```kotlin
fun main() = runBlocking<Unit> {
    launch(Dispatchers.Default) {
        launch { println("${Thread.currentThread().name} - Default 1") }
        launch { println("${Thread.currentThread().name} - Default 2") }
        launch { println("${Thread.currentThread().name} - Default 3") }
    }
}

// 출력
// DefaultDispatcher-worker-2 @coroutine#3 - Default 1
// DefaultDispatcher-worker-2 @coroutine#4 - Default 2
// DefaultDispatcher-worker-1 @coroutine#5 - Default 3
```

둘 다 `DefaultDispatcher-worker`라는 이름의 스레드를 사용하고 있다.

## Dispatcher 종류

- **Dispatchers.Main**: UI 작업용. Android에서는 메인 스레드에서 실행된다.
- **Dispatchers.IO**: 파일 읽기/쓰기, 네트워크 요청 등 IO 작업에 최적화된 스레드 풀에서 실행된다.
- **Dispatchers.Default**: CPU 집약적인 작업(데이터 처리, 계산 등)에 사용된다.
- **Dispatchers.Unconfined**: 특정 스레드에 제한되지 않고 호출한 컨텍스트를 그대로 이어받는다.

## limitedParallelism

병렬 실행 수를 제한하고 싶을 때 사용한다. Dispatchers.IO에서 사용하면 기존 IO 스레드 풀과 격리된 컨텍스트를 제공해서 특정 작업의 병렬 실행을 독립적으로 제어할 수 있다.

IO 스레드 풀과 격리되는 이유는 세 가지다. 첫째, IO 스레드 풀은 공유 자원이라 다른 IO 작업이 많아지면 포화 상태가 될 수 있다. 둘째, 제한된 병렬성은 별도의 논리적 컨텍스트를 만들어 다른 IO 작업의 부하에 영향받지 않는다. 셋째, 특정 작업이 과도한 IO 스레드 리소스를 사용하는 것을 방지할 수 있다.

## 참고

- [코틀린 코루틴 완전 정복 (인프런)](https://www.inflearn.com/course/%EC%BD%94%ED%8B%80%EB%A6%B0-%EC%BD%94%EB%A3%A8%ED%8B%B4-%EC%99%84%EC%A0%84-%EC%A0%95%EB%B3%B5/dashboard)
