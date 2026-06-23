---
title: Deferred, async/await, withContext
date: 2024-12-09
tags: [kotlin, coroutine, async, await, withContext, deferred]
order: 4
---

## Deferred와 async/await

Deferred는 Job을 상속받아 작업의 취소, 상태 추적 기능에 더해 비동기 작업의 결과를 반환할 수 있는 객체다. `async`는 새로운 코루틴을 시작하고 결과를 Deferred 객체로 반환한다.

```kotlin
fun main() = runBlocking {
    val deferred: Deferred<Int> = async {
        delay(1000L)
        42
    }

    println("작업 중...")
    val result = deferred.await()
    println("결과: $result")
}
```

`await`는 async 블록의 결과를 가져오기 위해 사용되며, 해당 작업이 완료될 때까지 현재 코루틴을 일시 중단한다. `Job.join()`은 작업 완료만 기다리는 반면, `Deferred.await()`는 작업 완료 후 결과 값까지 반환한다는 차이가 있다.

## withContext

withContext는 새로운 코루틴을 생성하지 않고 현재 코루틴의 컨텍스트를 전환한다. `Dispatchers.IO`로 전환하면 IO 최적화 스레드 풀에서, `Dispatchers.Default`로 전환하면 CPU 바운드 스레드 풀에서 작업이 실행된다. 결과 값을 바로 반환할 수 있다.

```kotlin
fun main() = runBlocking {
    println("작업 시작 [${Thread.currentThread().name}]")

    withContext(Dispatchers.IO) {
        println("IO 작업 중 [${Thread.currentThread().name}]")
        delay(1000L)
    }

    println("작업 종료 [${Thread.currentThread().name}]")
}

// 출력
// 작업 시작 [main] @coroutine#1
// IO 작업 중 [DefaultDispatcher-worker-1] @coroutine#1
// 작업 종료 [main] @coroutine#1
```

코루틴 번호가 `@coroutine#1`로 동일한 것을 볼 수 있다. 새 코루틴을 만든 게 아니라 컨텍스트만 전환한 것이다.

## 비교

| 특징 | async | withContext |
|------|-------|-------------|
| 새 코루틴 생성 여부 | 생성함 | 생성하지 않음 |
| 실행 결과 | Deferred 객체로 반환 | 바로 결과 반환 |
| 사용 목적 | 병렬 처리 | 컨텍스트 전환 및 순차 작업 |
