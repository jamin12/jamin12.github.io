---
title: Mono와 Flux
date: 2025-01-29
tags: [reactive, spring-reactive, mono, flux]
order: 3
---

Mono와 Flux는 리액티브 프로그래밍의 핵심 요소로, 데이터 스트림을 논블로킹 방식으로 비동기 처리할 수 있게 해준다.

- **Mono\<T\>**: 0 또는 1개의 데이터를 발행하는 Publisher
- **Flux\<T\>**: 0개 이상의 데이터를 발행하는 Publisher

```java
Mono<String> mono = Mono.just("Hello, Mono!");
Flux<String> flux = Flux.just("Hello", "Flux", "World");
```

## 동작 방식

Mono는 단일 데이터를 감싸는 래퍼 역할을 하며, 내부적으로 지연 실행(Deferred Execution) 방식으로 동작한다. `subscribe()`가 호출될 때까지 실행되지 않는다.

```java
Mono<String> mono = Mono.just("Reactive Programming")
    .map(String::toUpperCase)
    .doOnNext(System.out::println);

mono.subscribe(); // 이 시점에 실행
```

Flux는 여러 개의 데이터를 처리할 수 있으며, 내부적으로 `onNext()`를 여러 번 호출해서 데이터를 전송한다.

```java
Flux<Integer> flux = Flux.range(1, 5)
    .map(i -> i * 2)
    .doOnNext(System.out::println);

flux.subscribe();
```

## 주요 오퍼레이터

### 데이터 변환

| 오퍼레이터 | 설명 |
|-----------|------|
| map | 각 요소에 변환 함수 적용 |
| flatMap | Mono 또는 Flux로 변환 |
| filter | 특정 조건을 만족하는 데이터만 전달 |
| doOnNext | 값이 방출될 때 실행 |

### 데이터 결합

| 오퍼레이터 | 설명 |
|-----------|------|
| zip | 여러 Mono 또는 Flux를 결합하여 동기화 |
| merge | 여러 Flux의 데이터를 동시에 발행 |
| concat | 순차적으로 Flux를 연결 |
