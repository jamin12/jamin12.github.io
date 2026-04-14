---
title: Scheduler
date: 2025-02-20
tags: [reactive, spring-reactive, scheduler, publishOn, subscribeOn]
order: 7
---

## 병렬 처리

`parallel()`로 Flux 데이터 스트림을 여러 개의 병렬 실행 경로(rail)로 분할하고, `runOn()`으로 각 rail을 별도 스레드에서 실행할 수 있다.

```java
Flux.range(1, 10)
    .parallel(4)
    .runOn(Schedulers.parallel())
    .map(i -> {
        System.out.println("Processing " + i + " on " + Thread.currentThread().getName());
        return i * 2;
    })
    .sequential()
    .subscribe(result -> System.out.println("Result: " + result));
```

`sequential()`이 없으면 여러 스레드에서 동시에 데이터를 전달해서 동시성 문제가 발생할 수 있다. `sequential()`은 병렬 처리된 결과를 하나의 순차 스트림으로 병합하되, 4개의 결과가 모일 때까지 기다리는 게 아니라 각 rail이 끝나면 바로 결과를 보낸다.

## subscribeOn

구독 시점부터 Upstream 전체의 실행 스레드를 지정한다. 체인 내 어디에 위치하든 구독 시작 시점부터 영향을 미치며, 여러 개 있어도 최초의 subscribeOn만 적용된다.

```java
Flux.fromArray(new Integer[] {1, 3, 5, 7})
    .subscribeOn(Schedulers.boundedElastic())
    .doOnNext(data -> log.info("fromArray {}", data))
    .filter(data -> data > 3)
    .doOnNext(data -> log.info("filter {}", data))
    .map(data -> data * 10)
    .doOnNext(data -> log.info("map {}", data))
    .subscribe(data -> log.info("results {}", data));

// 모든 로그가 [boundedElastic-1] 스레드에서 출력
```

## publishOn

호출된 위치 이후의 Downstream 연산이 지정된 Scheduler에서 실행되도록 전환한다. 여러 번 사용해서 구간마다 다른 Scheduler를 지정할 수 있다.

```java
Flux.fromArray(new Integer[] {1, 3, 5, 7})
    .doOnNext(data -> log.info("fromArray {}", data))
    .publishOn(Schedulers.parallel())
    .filter(data -> data > 3)
    .doOnNext(data -> log.info("filter {}", data))
    .publishOn(Schedulers.parallel())
    .map(data -> data * 10)
    .doOnNext(data -> log.info("map {}", data))
    .subscribe(data -> log.info("result {}", data));

// fromArray는 [main], filter는 [parallel-2], map과 result는 [parallel-1]
```

## Schedulers 종류

| Scheduler | 용도 |
|-----------|------|
| `immediate()` | 현재 스레드에서 바로 실행. 스레드 전환 없음 |
| `single()` | 단일 스레드에서 순차 실행 |
| `parallel()` | CPU 집약적 작업용. CPU 코어 수에 맞춘 고정 스레드 |
| `boundedElastic()` | IO/블로킹 작업용. 필요시 스레드 생성하되 상한선 있음 |
| `fromExecutor(Executor)` | 커스텀 스레드 풀 사용 |

## 참고

- [Spring Reactive Web Application - Reactor 1부 (인프런)](https://www.inflearn.com/course/spring-reactive-web-application-reactor1%EB%B6%80/dashboard)
