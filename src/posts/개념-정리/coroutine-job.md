---
title: Job과 코루틴 제어
date: 2024-12-08
tags: [kotlin, coroutine, job, cancel, join]
order: 3
---

Job은 코루틴의 실행 단위를 나타내는 인터페이스다. 코루틴의 상태를 추적하고 실행 중인 작업을 제어할 수 있는 기능을 제공한다. 코루틴을 생성하면 자동으로 Job 객체가 만들어지고, 이걸 통해 작업 상태를 확인하거나 취소할 수 있다.

## join

join은 Job을 호출한 코루틴의 스레드를 일시 정지시킨다. Job 자체가 실행되는 스레드와는 별개의 동작이다. runBlocking 내부에서 join을 호출하면 메인 스레드가 대기 상태에 들어가고, 해당 Job이 완료될 때까지 실행이 멈춘다.

여러 Job을 순차적으로 처리하려면 각각 join을 걸어주면 된다.

```kotlin
fun main() = runBlocking {
    val job1 = launch {
        println("작업 1 시작")
        delay(1000)
        println("작업 1 완료")
    }
    job1.join()

    val job2 = launch {
        println("작업 2 시작")
        delay(1000)
        println("작업 2 완료")
    }
    job2.join()

    val job3 = launch {
        println("작업 3 시작")
        delay(1000)
        println("작업 3 완료")
    }
    job3.join()
}

// 출력
// 작업 1 시작
// 작업 1 완료
// 작업 2 시작
// 작업 2 완료
// 작업 3 시작
// 작업 3 완료
```

## 지연 로딩

코루틴은 기본적으로 생성 즉시 실행되지만, `CoroutineStart.LAZY`를 설정하면 명시적으로 시작하기 전까지 실행을 지연시킬 수 있다. `start()`를 호출하거나 `join()`, `await()`같은 대기 메서드를 호출할 때 비로소 실행된다.

```kotlin
fun main() = runBlocking {
    val lazyJob = launch(start = CoroutineStart.LAZY) {
        println("Lazy 코루틴 시작")
        delay(1000)
        println("Lazy 코루틴 완료")
    }
    println("Lazy Job 생성 완료")
    delay(500)
    println("Lazy Job 시작 요청")
    lazyJob.start()
    lazyJob.join()
    println("Lazy Job 완료 확인")
}

// 출력
// Lazy Job 생성 완료
// Lazy Job 시작 요청
// Lazy 코루틴 시작
// Lazy 코루틴 완료
// Lazy Job 완료 확인
```

## 취소

`Job.cancel()`은 취소 요청을 보내는 역할을 한다. 코루틴을 곧바로 취소하지 않고 취소 확인용 플래그를 "취소 요청됨"으로 바꾸는 것뿐이다. 코루틴 내부에서 `isActive` 상태를 확인하거나 취소 가능 함수(`delay`, `yield`)를 호출해야 실제로 취소된다.

`cancelAndJoin`은 취소 요청 후 취소가 완료될 때까지 호출 코루틴을 일시 중단한다.

```kotlin
fun main() = runBlocking {
    val job = launch {
        repeat(10) { i ->
            if (!isActive) return@launch
            println("작업 진행 중... $i")
            delay(500)
        }
    }

    delay(1200)
    println("작업 취소 요청")
    job.cancelAndJoin()
    println("작업 종료")
}

// 출력
// 작업 진행 중... 0
// 작업 진행 중... 1
// 작업 취소 요청
// 작업 종료
```

## 상태 변수

Job 객체는 코루틴의 상태를 나타내는 세 가지 변수를 제공한다.

- **isActive**: 코루틴이 실행 중일 때 true
- **isCancelled**: cancel이 호출되면 true (취소 중인 상태도 포함)
- **isCompleted**: 실행 완료되거나 취소 완료되면 true
