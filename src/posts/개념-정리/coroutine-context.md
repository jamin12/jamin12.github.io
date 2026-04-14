---
title: Coroutine Context
date: 2024-12-12
tags: [kotlin, coroutine, context, coroutineName, exceptionHandler]
order: 5
---

Coroutine Context는 코루틴이 실행될 때 이를 관리하고 제어하는 여러 요소들이 결합된 객체다. 여러 키-값 쌍으로 이루어진 데이터 구조이며, 구성 요소는 네 가지다.

- **Job**: 코루틴의 생명 주기를 관리한다. 부모-자식 관계를 형성해서 구조적 동시성을 구현한다.
- **Dispatcher**: 코루틴이 실행될 스레드나 스레드 풀을 지정한다.
- **CoroutineName**: 코루틴에 이름을 부여한다.
- **CoroutineExceptionHandler**: 코루틴 내부에서 발생한 예외를 처리하기 위한 핸들러다.

## Context 병합

`+` 연산자로 Context를 합칠 수 있다. 중복되지 않으면 모든 요소를 포함하고, 중복되면 나중에 추가된 요소가 우선한다.

```kotlin
val context1 = Dispatchers.IO + CoroutineName("Context1")
val context2 = Dispatchers.Default + CoroutineName("Context2")

val mergedContext = context1 + context2
println(mergedContext[CoroutineName]) // CoroutineName("Context2")
```

## 커스텀 Context가 필요한 이유

### 디버깅 및 로깅

코루틴이 복잡해질수록 어떤 코루틴이 어떤 작업을 수행하는지 식별하기 어려워진다. CoroutineName을 사용하면 로그에서 추적이 쉬워진다.

```kotlin
launch(CoroutineName("DataFetch")) {
    println("Running: ${coroutineContext[CoroutineName]?.name}")
}
```

### 특별한 예외 처리

기본적으로 코루틴 예외는 부모로 전파되지만, 특정 코루틴에서만 별도로 처리해야 하는 상황이 있을 수 있다.

```kotlin
val handler = CoroutineExceptionHandler { _, exception ->
    println("Caught exception: $exception")
}
launch(handler) {
    throw RuntimeException("Test exception")
}
```

### 구조적 동시성 관리

여러 코루틴의 생명 주기를 관리하기 위해 커스텀 Job을 추가하거나, 부모와 다른 생명 주기를 가진 코루틴을 만들 수 있다.

```kotlin
val parentJob = Job()
launch(parentJob) {
    // 이 코루틴은 parentJob의 영향을 받음
}
```

## 참고

- [코틀린 코루틴 완전 정복 (인프런)](https://www.inflearn.com/course/%EC%BD%94%ED%8B%80%EB%A6%B0-%EC%BD%94%EB%A3%A8%ED%8B%B4-%EC%99%84%EC%A0%84-%EC%A0%95%EB%B3%B5/dashboard)
