---
title: Sinks
date: 2025-02-11
tags: [reactive, spring-reactive, sinks]
order: 6
---

리액티브 스트림에서 데이터 흐름은 보통 Publisher → Subscriber로 이어진다. 그런데 외부에서 발생한 이벤트를 리액티브 스트림에 주입해야 하는 경우가 있다. Mono나 Flux는 기본적으로 읽기 전용이라, 생성 시점에 값이 고정되고 이후에 외부에서 데이터를 밀어넣을 수 없다.

과거에는 Processor라는 컴포넌트를 사용했지만, 상태 관리가 불명확하고 동시성 이슈가 있었다. 이를 보완해서 나온 게 Sinks다.

## Sinks 종류

### Sinks.One

단 하나의 값 또는 에러를 발행할 수 있다.

```java
Sinks.One<String> sink = Sinks.one();
sink.tryEmitValue("Hello Reactor!");

Mono<String> mono = sink.asMono();
mono.subscribe(System.out::println);
```

### Sinks.Empty

값 없이 완료 또는 에러 시그널만 발행한다.

```java
Sinks.Empty<Void> sink = Sinks.empty();
sink.tryEmitEmpty();
Mono<Void> mono = sink.asMono();
mono.subscribe(null, Throwable::printStackTrace, () -> System.out.println("Completed!"));
```

### Sinks.Many

다수의 값을 순차적으로 발행한다. 세 가지 종류가 있다.

**Unicast** — 단일 구독자만 허용:

```java
Sinks.Many<String> unicastSink = Sinks.many().unicast().onBackpressureBuffer();
Flux<String> flux = unicastSink.asFlux();
flux.subscribe(System.out::println);

unicastSink.tryEmitNext("Event 1");
unicastSink.tryEmitNext("Event 2");
unicastSink.tryEmitComplete();
```

**Multicast** — 여러 구독자에게 동시에 발행:

```java
Sinks.Many<String> multicastSink = Sinks.many().multicast().directBestEffort();
Flux<String> flux = multicastSink.asFlux();
flux.subscribe(data -> System.out.println("Subscriber 1: " + data));
flux.subscribe(data -> System.out.println("Subscriber 2: " + data));

multicastSink.tryEmitNext("Broadcast Event");
multicastSink.tryEmitComplete();
```

**Replay** — 늦게 구독해도 이전 이벤트를 캐시해서 재전달:

```java
Sinks.Many<String> replaySink = Sinks.many().replay().all();
replaySink.tryEmitNext("Cached Event 1");
replaySink.tryEmitNext("Cached Event 2");

Flux<String> flux = replaySink.asFlux();
flux.subscribe(data -> System.out.println("Replay Subscriber: " + data));
replaySink.tryEmitComplete();
```

## Signal Emission

신호를 발행할 때는 `tryEmit*` 메서드를 사용한다.

- `tryEmitNext(T value)` — 새로운 데이터 발행
- `tryEmitComplete()` — 정상 종료
- `tryEmitError(Throwable error)` — 에러 발생 알림

반환되는 `EmitResult`로 성공 여부를 확인할 수 있다. `OK`면 성공, `FAIL_TERMINATED`면 이미 종료된 상태, `FAIL_OVERFLOW`면 버퍼 오버플로우다. 에러나 완료 신호를 발행하면 Sink는 종료 상태가 되어 추가 신호를 주입할 수 없다.
