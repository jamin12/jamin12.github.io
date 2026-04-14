---
title: 리액티브 스트림 구성요소
date: 2025-01-25
tags: [reactive, spring-reactive, publisher, subscriber]
order: 2
---

리액티브 스트림의 핵심 구성요소를 정리한다.

- **Publisher**: 데이터를 방출(emit)하는 역할
- **Subscriber**: Publisher가 방출한 데이터를 소비하는 역할. `onSubscribe`, `onNext`, `onError`, `onComplete` 메서드로 데이터를 처리한다
- **Emit**: Publisher가 데이터를 내보내는 행위
- **Sequence**: Publisher가 emit하는 데이터의 연속적인 흐름. Operator 체인 형태로 정의된다
- **Subscribe**: Subscriber가 Sequence를 구독해서 데이터를 전달받기 시작하는 행위
- **Dispose**: Subscriber가 Sequence 구독을 중단하는 것

```java
Flux<String> publisher = Flux.just("Data 1", "Data 2", "Data 3", "Data 4", "Data 5");

publisher.subscribe(
    data -> System.out.println("Received: " + data),   // onNext
    error -> System.err.println("Error: " + error.getMessage()), // onError
    () -> System.out.println("Completed!")               // onComplete
);
```

## 전체 흐름

Publisher가 Sequence를 정의하면, 이 단계에서는 실제 데이터가 방출되지 않는다. Subscriber가 `subscribe()`를 호출하면 데이터 흐름이 시작되고, Publisher는 `onNext`를 통해 데이터를 하나씩 emit한다. 처리 도중 오류가 발생하면 `onError`가, 모든 데이터 방출이 완료되면 `onComplete`가 호출된다. 필요에 따라 Subscriber는 구독을 중단(Dispose)할 수 있다.

## 참고

- [Spring Reactive Web Application - Reactor 1부 (인프런)](https://www.inflearn.com/course/spring-reactive-web-application-reactor1%EB%B6%80/dashboard)
