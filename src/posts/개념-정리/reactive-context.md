---
title: Context
date: 2025-02-27
tags: [reactive, spring-reactive, context]
order: 8
---

전통적인 ThreadLocal 방식은 스레드 전환이 잦은 Reactive 환경에서는 제대로 동작하지 않는다. Context는 이 한계를 극복하기 위해, 데이터 스트림 전반에 걸쳐 부가 정보를 안전하게 전달할 수 있도록 해주는 불변 객체다.

값을 저장할 때는 `contextWrite()`, 읽을 때는 읽기 전용 뷰인 `ContextView`를 `deferContextual()` 또는 `transformDeferredContextual()`을 통해 사용한다.

## 구독마다 별도의 Context

각 구독은 독립적인 Context를 가진다.

```java
Mono<String> mono = Mono.deferContextual(ctx ->
        Mono.just("ID: " + ctx.get("id"))
    )
    .publishOn(Schedulers.parallel());

mono.contextWrite(context -> context.put("id", "itVillage"))
    .subscribe(data -> log.info("subscriber 1: {}", data));

mono.contextWrite(context -> context.put("id", "itWorld"))
    .subscribe(data -> log.info("subscriber 2: {}", data));

// subscriber 1: ID: itVillage
// subscriber 2: ID: itWorld
```

## 전파 순서

Context는 구독에 가까운 부분부터 위로 전파된다. Context read 연산자가 Context write 연산자보다 아래에 위치하면 해당 write의 값이 반영되지 않는다.

```java
Mono.deferContextual(ctx ->
        Mono.just(ctx.get("id"))
    )
    .publishOn(Schedulers.parallel())
    .contextWrite(context -> context.put("name", "Kevin"))
    .transformDeferredContextual((mono, ctx) ->
        mono.map(data -> data + ", " + ctx.getOrDefault("name", "Tom"))
    )
    .contextWrite(context -> context.put("id", "itVillage"))
    .subscribe(Logger::onNext);

// 출력: itVillage, Tom
```

`name`은 read보다 위에서 write되었기 때문에 읽히지 않고 기본값 "Tom"이 사용되었다.

## 동일한 키 덮어쓰기

같은 키로 여러 번 값을 넣으면 새로운 Context가 생성되면서 기존 값을 덮어쓴다. 전파 순서상 아래쪽(구독에 가까운 쪽) contextWrite가 먼저 반영되므로, 위쪽 contextWrite가 최종값이 된다.

## Inner Sequence와 외부 Context

Inner Sequence 내부에서는 외부 Context 데이터를 읽을 수 있지만, Inner Sequence 내부에서 새로 저장한 데이터는 외부에서 읽을 수 없다. 변경사항은 Inner Sequence 내에서만 유효하다.

## 참고

- [Spring Reactive Web Application - Reactor 1부 (인프런)](https://www.inflearn.com/course/spring-reactive-web-application-reactor1%EB%B6%80/dashboard)
