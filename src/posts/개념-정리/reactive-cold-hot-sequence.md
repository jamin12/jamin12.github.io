---
title: Cold Sequence와 Hot Sequence
date: 2025-01-30
tags: [reactive, spring-reactive, cold-sequence, hot-sequence]
order: 4
---

Reactor에서 Flux와 Mono는 데이터 흐름의 성격에 따라 Cold Sequence 또는 Hot Sequence로 나뉜다.

- **Cold Sequence**: Subscriber가 구독할 때마다 새로운 데이터 스트림을 생성
- **Hot Sequence**: 데이터 스트림이 이미 동작 중이며, Subscriber가 중간에 참여

## Cold Sequence

구독할 때마다 새로운 데이터 스트림을 생성한다. Subscriber마다 독립적인 데이터를 받는다.

```java
Flux<String> coldFlux = Flux.fromIterable(Arrays.asList("RED", "YELLOW", "PINK"))
    .map(String::toLowerCase);

coldFlux.subscribe(country -> log.info("# Subscriber1: {}", country));
log.info("-------------------------");
coldFlux.subscribe(country -> log.info("# Subscriber2: {}", country));

// 출력
// Subscriber1: red, yellow, pink
// -------------------------
// Subscriber2: red, yellow, pink
```

각 Subscriber가 독립적으로 같은 데이터를 받는다. 데이터 무결성은 보장되지만, 동일한 데이터를 여러 번 생성해야 하니 리소스 낭비가 있을 수 있다.

## Hot Sequence

데이터 스트림이 이미 동작 중이며, 구독자는 중간에 합류한다. `share()`를 사용하면 원본 Flux를 여러 Subscriber가 공유한다.

```java
Flux<String> concertFlux =
    Flux.fromStream(Stream.of("Singer A", "Singer B", "Singer C", "Singer D", "Singer E"))
        .delayElements(Duration.ofSeconds(1)).share();

concertFlux.subscribe(singer -> log.info("# Subscriber1 is watching {}'s song.", singer));

Thread.sleep(2500);

concertFlux.subscribe(singer -> log.info("# Subscriber2 is watching {}'s song.", singer));

Thread.sleep(3000);
```

Subscriber2는 2.5초 뒤에 구독했기 때문에 Singer A, B는 놓치고 Singer C부터 받는다. 이전 데이터를 다시 받을 수 없고, 현재 진행 중인 스트림만 받을 수 있다. 실시간 데이터 스트림(WebSocket, Kafka, 센서 데이터 등)에 유리하다.

## 변환

Cold를 Hot으로 변환하려면 `publish()` 또는 `share()`를 사용한다.

```java
Flux<Integer> coldFlux = Flux.range(1, 5).publish().autoConnect();
Flux<Integer> hotFlux = Flux.range(1, 5).share();
```

Hot을 다시 Cold로 만들려면 `cache()`를 사용한다.

```java
Flux<Integer> coldAgain = hotFlux.cache();
```
