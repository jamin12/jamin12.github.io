---
title: Backpressure
date: 2025-02-01
tags: [reactive, spring-reactive, backpressure]
order: 5
---

Backpressure는 Producer가 Consumer보다 빠르게 데이터를 생성할 때, 소비자의 속도에 맞춰 생산자가 데이터를 공급하도록 조절하는 메커니즘이다.

Spring MVC의 블로킹 모델에서는 Thread-per-Request 방식이라 요청마다 스레드를 할당하지만, WebFlux에서는 적은 수의 스레드로 요청을 처리하므로 데이터가 과부하 상태가 되면 OOM이나 성능 저하가 발생할 수 있다. Backpressure를 활용하면 이런 과부하를 방지할 수 있다.

## Backpressure 전략

### Ignore

Backpressure를 적용하지 않는다. 소비자가 처리 속도를 조절하지 않고 생산자가 데이터를 계속 밀어내는 방식이라, 소비자가 감당 못하면 OOM이 발생할 수 있다.

### Error

내부 버퍼가 가득 찰 경우 Exception을 발생시킨다.

```java
Flux.range(1, 1000)
    .onBackpressureError()
    .subscribe(System.out::println, e -> System.err.println("Error: " + e));
```

### Drop

소비자가 감당할 수 없는 데이터를 버린다. 먼저 emit된 데이터부터 Drop시킨다.

```java
Flux.range(1, 1000)
    .onBackpressureDrop(i -> System.out.println("Dropped: " + i))
    .subscribe(System.out::println);
```

### Latest

내부 버퍼가 가득 찰 경우 가장 최근에 emit된 데이터만 유지하고 나머지를 삭제한다. 최신 데이터의 중요도가 높은 경우 유용하다.

```java
Flux.range(1, 1000)
    .onBackpressureLatest()
    .subscribe(System.out::println);
```

### Buffer Drop Latest / Drop Oldest

버퍼를 유지하면서 가득 차면 최근 데이터를 유지하고 오래된 데이터를 삭제하거나(Drop Oldest), 반대로 오래된 데이터를 유지하고 최근 데이터를 삭제한다(Drop Latest).

```java
// Drop Oldest
Flux.range(1, 1000)
    .onBackpressureBuffer(100, i -> System.out.println("overflow: " + i),
        BufferOverflowStrategy.DROP_OLDEST)
    .subscribe(System.out::println);
```
