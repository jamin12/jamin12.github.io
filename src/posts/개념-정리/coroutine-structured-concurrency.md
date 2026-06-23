---
title: 구조화된 동시성
date: 2024-12-21
tags: [kotlin, coroutine, structured-concurrency, coroutineScope]
order: 6
---

## 실행환경 복사

코루틴은 기본적으로 부모의 컨텍스트를 복사해서 새로운 컨텍스트를 생성한다. 특정 속성은 명시적으로 덮어쓸 수 있다.

```kotlin
runBlocking {
    launch {
        println("부모 컨텍스트 상속")
    }

    launch(Dispatchers.Default) {
        println("디스패처 덮어쓰기")
    }
}
```

각 코루틴은 독립적인 Job을 생성한다. launch나 async는 항상 새로운 Job을 만들고, 부모의 컨텍스트를 상속받아 구조화된 동작을 유지한다. 각 Job은 독립적으로 실행되지만 부모-자식 관계를 통해 라이프사이클이 관리된다.

## 취소 전파

부모 코루틴이 취소되면 자식 코루틴도 모두 취소된다.

```kotlin
runBlocking {
    val parentJob = launch {
        val childJob1 = launch {
            delay(1000)
            println("Child Job 1 완료")
        }

        val childJob2 = launch {
            delay(2000)
            println("Child Job 2 완료")
        }

        println("Parent Job 진행 중")
        delay(500)
        cancel()
    }

    parentJob.join()
    println("Parent Job 완료")
}

// 출력
// Parent Job 진행 중
// Parent Job 완료
```

부모를 cancel했더니 자식 Job 1, 2 모두 출력되지 않았다.

## 완료 의존성

부모 코루틴은 기본적으로 모든 자식 코루틴이 완료될 때까지 기다린다. `join()`이나 `await()`로 명시적으로 제어할 수도 있다.

```kotlin
runBlocking {
    val parentJob = launch {
        launch {
            delay(1000)
            println("Child Job 1 완료")
        }

        launch {
            delay(2000)
            println("Child Job 2 완료")
        }

        println("Parent Job 진행 중")
    }

    parentJob.join()
    println("Parent Job 완료")
}

// 출력
// Parent Job 진행 중
// Child Job 1 완료
// Child Job 2 완료
// Parent Job 완료
```

cancel 없이 join만 했더니 자식이 모두 완료된 후에야 Parent Job 완료가 출력된다.

## CoroutineScope

CoroutineScope는 코루틴의 생명주기를 관리하고 컨텍스트를 제공하는 역할을 한다. 스코프 내에서 생성된 모든 코루틴은 해당 스코프의 자식으로 동작하며, 부모 스코프가 취소되면 자식도 함께 취소된다.

그런데 `CoroutineScope()`로 명시적으로 새 스코프를 만들면 부모-자식 관계가 끊어진다.

```kotlin
fun main() = runBlocking<Unit> {
    launch(CoroutineName("Coroutine1")) {
        launch(CoroutineName("Coroutine3")) {
            delay(100L)
            println("[${Thread.currentThread().name}] 1코루틴 실행 완료")
        }
        CoroutineScope(Dispatchers.Default).launch(CoroutineName("Coroutine4")) {
            delay(100L)
            println("[${Thread.currentThread().name}] 2코루틴 실행 완료")
        }
        this.cancel()
    }
    delay(1000)
}

// 출력
// [DefaultDispatcher-worker-1] 2코루틴 실행 완료
```

Coroutine3은 부모에 종속되어 있어서 cancel에 의해 취소됐지만, Coroutine4는 새로운 CoroutineScope 안에서 동작하기 때문에 영향을 받지 않았다.

마찬가지로 Job 자체를 새로 설정해도 같은 결과가 나온다.

```kotlin
launch(CoroutineName("Coroutine4") + Job()) {
    delay(100L)
    println("[${Thread.currentThread().name}] 2코루틴 실행 완료")
}
```

Job을 새로 만들면 부모가 설정되지 않으니 독립적으로 실행된다.
