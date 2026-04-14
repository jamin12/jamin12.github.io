---
title: Reactive 디버깅
date: 2025-03-03
tags: [reactive, spring-reactive, debugging, checkpoint]
order: 9
---

리액티브 스트림에서 에러가 발생하면 일반적인 스택트레이스만으로는 어디서 문제가 생겼는지 파악하기 어렵다. Reactor는 이를 위해 여러 디버깅 도구를 제공한다.

## Hooks.onOperatorDebug()

전역적으로 모든 Operator의 Assembly 정보를 캡처한다. 에러 발생 시 suppressed exception 형태로 어느 지점에서 스트림이 구성되었는지 확인할 수 있다. 단, 모든 정보를 캡처하므로 성능 저하가 있을 수 있다.

```java
Hooks.onOperatorDebug();

Flux.just(2, 4, 6, 8)
    .zipWith(Flux.just(1, 2, 3, 0), (x, y) -> x / y)
    .subscribe(Logger::onNext, Logger::onError);
```

## checkpoint()

특정 Operator 체인 내에서만 로컬하게 Assembly Stacktrace를 캡처한다. 필요한 부분에만 추가하면 되니 전역 디버깅보다 성능 영향이 적다.

```java
Flux.just(2, 4, 6, 8)
    .zipWith(Flux.just(1, 2, 3, 0), (x, y) -> x / y)
    .checkpoint()
    .map(num -> num + 2)
    .checkpoint()
    .subscribe(Logger::onNext, Logger::onError);
```

`checkpoint(description)`으로 설명을 붙이거나, `checkpoint(description, true)`로 고유 식별자와 상세 정보를 함께 출력할 수도 있다.

## log()

리액티브 스트림에서 발생하는 Signal 이벤트(onNext, onError, onComplete, 구독, 취소, 요청 등)를 실시간으로 출력한다. 여러 위치에 log()를 넣어서 Operator마다 흐름을 추적할 수 있다.

```java
Flux.fromArray(new String[] {"BANANAS", "APPLES", "PEARS", "MELONS"})
    .log()
    .map(String::toLowerCase)
    .log()
    .map(fruit -> fruit.substring(0, fruit.length() - 1))
    .log()
    .subscribe(Logger::onNext, Logger::onError);
```

## 참고

- [Spring Reactive Web Application - Reactor 1부 (인프런)](https://www.inflearn.com/course/spring-reactive-web-application-reactor1%EB%B6%80/dashboard)
