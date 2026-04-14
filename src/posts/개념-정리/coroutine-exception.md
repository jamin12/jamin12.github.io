---
title: 코루틴에서의 예외 처리
date: 2024-12-22
tags: [kotlin, coroutine, exception, supervisorJob, supervisorScope]
order: 7
---

## 예외 전파

코루틴에서 예외는 기본적으로 부모로 전파된다. 자식에서 예외가 발생하면 해당 코루틴이 취소되고, 부모와 다른 자식 코루틴까지 영향을 받는다.

```kotlin
fun main() = runBlocking {
    launch {
        throw Exception("Something went wrong")
    }
    launch {
        println("test")
    }
}
```

첫 번째 launch에서 Exception이 발생하면 부모 코루틴도 영향을 받아 두 번째 launch의 "test"는 출력되지 않는다.

## 예외 전파 제한

### 구조화를 깨기

별도의 CoroutineScope를 만들어서 부모-자식 관계를 끊으면 예외가 전파되지 않는다.

```kotlin
fun main() = runBlocking {
    CoroutineScope(Dispatchers.Default).launch {
        throw Exception("This exception will not affect the parent")
    }
    println("Parent continues")
}
```

### SupervisorJob

SupervisorJob을 사용하면 자식 코루틴에서 발생한 예외가 부모로 전파되지 않는다.

```kotlin
fun main() = runBlocking {
    val supervisor = SupervisorJob()
    val scope = CoroutineScope(supervisor + Dispatchers.Default)

    val job1 = scope.launch {
        throw Exception("Job1 failed")
    }

    val job2 = scope.launch {
        println("Job2 is running")
    }

    joinAll(job1, job2)
}
```

주의할 점이 있다. `launch(SupervisorJob())`처럼 코루틴 빌더에 직접 넣으면 안 된다. launch는 내부적으로 부모의 Job을 기반으로 자식 Job을 생성하기 때문에, 부모가 일반 Job이면 SupervisorJob의 역할을 제대로 못하게 된다.

### supervisorScope

supervisorScope 함수를 사용하면 SupervisorJob 객체를 가진 CoroutineScope가 생성된다. 코드가 모두 실행되고 자식 코루틴까지 완료되면 자동으로 완료된다.

```kotlin
fun main() = runBlocking {
    supervisorScope {
        launch {
            throw Exception("Child failed")
        }

        launch {
            println("Sibling is unaffected")
        }
    }
}
```

## CoroutineExceptionHandler

코루틴의 예외를 처리할 수 있는 핸들러다. launch에서만 동작한다.

```kotlin
fun main() = runBlocking<Unit> {
    val exceptionHandler = CoroutineExceptionHandler { _, throwable ->
        println("예외 발생 ${throwable}")
    }

    CoroutineScope(Dispatchers.IO).launch(CoroutineName("Coroutine1")) {
        launch(CoroutineName("Coroutine2") + exceptionHandler) {
            throw Exception("Coroutine2에 예외가 발생했습니다")
        }
    }

    delay(1000L)
}
```

이 코드에서 exceptionHandler가 동작할 것 같지만 실제로는 안 된다. 에러가 난 코루틴은 에러를 부모에게 던지기만 하기 때문이다. Coroutine1에 exceptionHandler를 설정해야 정상 동작한다.

## try-catch

코루틴 내부에서 로컬한 예외 처리가 필요하면 try-catch를 사용할 수 있다.

```kotlin
fun main() = runBlocking {
    val job = launch {
        try {
            throw Exception("Try-catch example")
        } catch (e: Exception) {
            println("Caught: ${e.message}")
        }
    }
    job.join()
}
```

## async 예외 처리

async 내부에서 try-catch로 에러를 잡으면 Deferred 객체로 전달되지 않고, await에서 에러가 발생하지 않는다.

```kotlin
val deferred = async {
    try {
        throw Exception("Something went wrong!")
    } catch (e: Exception) {
        println("Caught exception in async: ${e.message}")
    }
}
deferred.await()
```

반대로 async 내부에서 잡지 않으면 await 호출 시 에러가 발생한다.

```kotlin
val deferred = async {
    throw Exception("Something went wrong!")
}

try {
    deferred.await()
} catch (e: Exception) {
    println("Caught exception in await: ${e.message}")
}
```

정리하면, try-catch로 예외를 잡아도 해당 코루틴의 Job은 취소 상태로 설정되고 부모에 전파된다. 다른 코루틴이 영향받지 않게 하려면 supervisorScope을 사용해야 한다.

```kotlin
fun main() = runBlocking {
    supervisorScope {
        val deferred = async {
            throw Exception("Something went wrong!")
        }

        try {
            deferred.await()
        } catch (e: Exception) {
            println("Caught exception in await: ${e.message}")
        }
    }
    println("Parent coroutine is not cancelled.")
}
```
