---
title: 공유 자원 관리
date: 2025-01-01
tags: [kotlin, coroutine, mutex, volatile, 동시성]
order: 9
---

스레드 간에 데이터를 전달하거나 자원을 공유할 때 가변 변수를 통해 상태를 공유하게 된다. 여러 스레드에서 동시에 접근해 값을 변경하면 데이터 손실이나 불일치가 발생할 수 있다.

```kotlin
var count = 0

fun main(): Unit = runBlocking<Unit> {
    withContext(Dispatchers.Default) {
        repeat(10_000) {
            launch {
                count += 1
            }
        }
    }
    println("count = $count")
}

// 출력
// count = 9745
```

10000번을 증가시켰는데 최종 결과는 9745가 나왔다.

## 메모리 가시성 문제

한 코루틴이 공유 데이터의 상태를 변경했는데 다른 코루틴이 이를 즉시 인지하지 못하는 상황이다. CPU 캐시 같은 하드웨어적인 요소 때문에 메인 메모리에 업데이트되기 전에 다른 스레드에서 값을 가져가버리는 것이다.

`@Volatile`을 사용하면 가변 변수의 변경이 메인 메모리로 바로 반영된다.

```kotlin
@Volatile
var count = 0

fun main(): Unit = runBlocking<Unit> {
    withContext(Dispatchers.Default) {
        repeat(10_000) {
            launch {
                count += 1
            }
        }
    }
    println("count = $count")
}

// 출력
// count = 9679
```

하지만 여전히 카운트가 맞지 않는다. 메모리 가시성은 해결했지만, 경쟁 상태는 해결하지 못한 것이다.

## 경쟁 상태와 Mutex

경쟁 상태는 여러 코루틴이 동시에 공유 자원에 접근해서 데이터 일관성이 깨지는 상황이다. 공유 변수의 변경 가능 지점을 임계 영역으로 만들어 동시 접근을 제한해야 한다.

코루틴에서는 Mutex 객체를 사용한다. `lock`으로 락을 획득하고, `unlock`이 호출될 때까지 다른 코루틴이 임계 영역에 진입할 수 없다.

```kotlin
val mutex = Mutex()

fun main(): Unit = runBlocking<Unit> {
    withContext(Dispatchers.Default) {
        repeat(10_000) {
            launch {
                mutex.withLock {
                    count += 1
                }
            }
        }
    }
    println("count = $count")
}

// 출력
// count = 10000
```

Mutex의 lock은 일시 중단 함수라서, 다른 코루틴이 락을 잡고 있으면 스레드를 블로킹하지 않고 일시 중단된다. 락이 해제되면 다시 재개된다.

## 참고

- [코틀린 코루틴 완전 정복 (인프런)](https://www.inflearn.com/course/%EC%BD%94%ED%8B%80%EB%A6%B0-%EC%BD%94%EB%A3%A8%ED%8B%B4-%EC%99%84%EC%A0%84-%EC%A0%95%EB%B3%B5/dashboard)
