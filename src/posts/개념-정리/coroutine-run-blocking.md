---
title: runBlocking
date: 2024-12-07
tags: [kotlin, coroutine, runBlocking]
order: 1
---

`runBlocking`은 비동기 코드를 동기적인 환경으로 가져오는 역할을 한다.

`launch`, `async`, `produce`는 비동기 코드를 동기 코드처럼 사용할 수 있게 해주는 도구다. 반면 runBlocking은 비동기 코드를 완전히 동기 코드로 변환해주는 특별한 도구다. 예를 들어 `delay(1000)`이라는 비동기 함수는 코루틴 안에서만 사용 가능하지만, runBlocking으로 감싸면 동기 코드처럼 실행된다.

```kotlin
fun main() {
    println("Task a: Start")
    println("Task b: Start")

    runBlocking {
        println("Task c: runBlocking Start")

        launch {
            delay(1000L)
            println("Task d: Coroutine 1 Complete")
        }

        launch {
            delay(500L)
            println("Task e: Coroutine 2 Complete")
        }

        println("Task f: runBlocking End")
    }

    println("Task g: Start")
}
```

실행 순서를 보면, Task a와 b는 메인 스레드에서 순차 실행된다. runBlocking 블록이 시작되면 Task c가 출력되고, 두 개의 launch가 비동기로 시작된 뒤 Task f가 바로 출력된다. launch는 비동기이기 때문에 시작만 해놓고 넘어가는 것이다. 이후 0.5초 뒤에 Task e, 1초 뒤에 Task d가 출력되고, runBlocking이 종료된 후에야 Task g가 실행된다.

## 주의점

runBlocking은 주로 코드 테스트나 디버깅 상황에서 쓰인다. 동기 코드 안에서 간단하게 코루틴 코드를 실행할 수 있다는 장점이 있지만, 메인 스레드를 차단하기 때문에 실무에서 사용할 때는 신중해야 한다.
