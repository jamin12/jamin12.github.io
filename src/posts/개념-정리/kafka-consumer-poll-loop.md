---
title: "Kafka 컨슈머 poll 루프의 스레드"
date: 2026-08-27
tags: [kafka, consumer-group, java, offset]
summary: poll은 부른 스레드를 붙잡고, 백그라운드 스레드는 heartbeat만 보낸다
---

## 컨슈머가 부르는 것은 셋이다

```java
Properties properties = new Properties();
properties.setProperty(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
properties.setProperty(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
properties.setProperty(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class.getName());
properties.setProperty(ConsumerConfig.GROUP_ID_CONFIG, "group-01");
properties.setProperty(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");

try (KafkaConsumer<String, String> kafkaConsumer = new KafkaConsumer<>(properties)) {
    kafkaConsumer.subscribe(List.of(topicName));

    while (true) {
        ConsumerRecords<String, String> records = kafkaConsumer.poll(Duration.ofMillis(1000));
        for (ConsumerRecord<String, String> record : records) {
            logger.info("key: {} value: {} partition: {} offset: {}",
                record.key(), record.value(), record.partition(), record.offset());
        }
    }
}
```

- **`subscribe`** — 읽을 토픽을 등록한다. 인자가 `Collection`이라 여러 토픽을 한 번에 구독할 수 있다.
- **`poll`** — 브로커에서 레코드를 가져온다. 반환값은 레코드 하나가 아니라 여러 건이 담긴 `ConsumerRecords`라, 그것을 다시 루프로 펼쳐 `ConsumerRecord` 하나씩 꺼낸다.
- **커밋** - 재시작 때 이어 읽을 위치를 브로커에 기록한다. 이 코드에서는 자동 커밋이 켜져 있어 `poll` 안에서 요청을 보낸다. 저장 시점과 수동 커밋 방식은 [오프셋 커밋](/posts/kafka-consumer-offset-commit)에서 다룬다.

설정에서 프로듀서와 갈리는 자리가 둘이다.

- **Deserializer를 지정한다.** 프로듀서의 `key.serializer`·`value.serializer` 자리에 `key.deserializer`·`value.deserializer`가 온다.
- **`group.id`가 필수다.** 지정하지 않고 `subscribe`를 부르면 `InvalidGroupIdException`이 난다 — 그룹 관리와 커밋 API가 전부 그룹 이름에 매여 있어서다.

## poll은 부른 스레드를 붙잡는다

`poll`이 하는 일의 순서가 `ClassicKafkaConsumer`에 그대로 있다. 버퍼에 이미 모아 둔 레코드가 있으면 그것을 곧바로 돌려주고, 없으면 fetch 요청을 만들어 보낸 뒤 응답을 기다린다.

```mermaid
flowchart TD
    P["poll(timeout) 호출"] --> C{"버퍼에 레코드가 있나"}
    C -->|"있음"| R["즉시 반환"]
    C -->|"없음"| S["fetch 요청 전송"]
    S --> W["응답 대기 — 최대 timeout"]
    W --> D["역직렬화"]
    D --> R
```

요청 전송, 응답 수신, 역직렬화가 전부 `poll`을 부른 스레드에서 일어난다. 그래서 `KafkaConsumer`는 thread-safe하지 않다 — 메서드마다 잠금을 잡고 들어가며, 다른 스레드가 같은 컨슈머를 동시에 만지면 `ConcurrentModificationException`으로 막는다. 한 컨슈머는 한 스레드가 쓴다.

레코드를 반환하기 직전에 다음 fetch 요청을 미리 내보내는 것도 이 스레드다. 애플리케이션이 방금 받은 레코드를 처리하는 동안 브로커에서 다음 묶음이 날아오고 있으므로, 다음 `poll`은 대개 기다리지 않고 버퍼에서 바로 꺼내 준다.

## 백그라운드 스레드는 heartbeat만 보낸다

컨슈머에도 백그라운드 스레드가 하나 있다. `AbstractCoordinator`의 내부 클래스 `HeartbeatThread`이고, 스레드 이름은 `kafka-coordinator-heartbeat-thread`에 `group.id`를 이어 붙인 형태다. 컨슈머를 만들 때가 아니라 첫 `poll`이 코디네이터를 찾아 그룹에 합류하는 `ensureActiveGroup()` 안에서 만들어지므로, 디버거로 `coordinator` 필드를 열어 보면 첫 `poll` 전에는 `heartbeatThread`가 `null`이다.

하는 일이 둘이다.

- **`heartbeat.interval.ms`마다 그룹 코디네이터에 heartbeat를 보낸다.** 컨슈머 프로세스가 살아있다는 신고다.
- **애플리케이션 스레드가 `poll`을 다시 불렀는지 감시한다.** `max.poll.interval.ms`를 넘기면 스스로 LeaveGroup을 보내고 그룹에서 빠진다.

레코드를 가져오거나 역직렬화하거나 커밋하지는 않는다. 그룹에 아직 합류하지 않은 상태면 스스로 잠들어 있는다.

## 타임아웃이 두 개인 이유

heartbeat를 별도 스레드로 뽑아낸 것은 Kafka 0.10.1의 결과다. 그전에는 heartbeat도 `poll` 안에서 보냈기 때문에, 받은 레코드를 DB에 쓰는 데 오래 걸리면 그 사이 heartbeat가 나가지 않아 살아있는 컨슈머가 죽은 것으로 판정됐다. 처리가 느린 것과 프로세스가 멈춘 것을 구분할 수단이 없었다.

그래서 감시를 둘로 나눴다.

| 설정 | 재는 것 | 넘겼을 때 | 기본값 (4.2.1) |
|---|---|---|---|
| `heartbeat.interval.ms` | heartbeat 전송 주기 | — | `3000` |
| `session.timeout.ms` | heartbeat가 끊긴 시간 | 브로커가 멤버를 축출한다 | `45000` |
| `max.poll.interval.ms` | `poll` 사이의 간격 | 컨슈머가 스스로 그룹에서 빠진다 | `300000` |

`session.timeout.ms`는 프로세스의 생사를, `max.poll.interval.ms`는 처리의 진행을 각각 본다. 처리 로직이 5분 넘게 걸리면 heartbeat는 정상인데도 그룹에서 빠져 리밸런싱이 일어나고, 그 뒤의 커밋이 `CommitFailedException`을 받는다. 이미 파티션을 잃은 컨슈머가 커밋하려 드는 상황이라 거절된다.

처리가 오래 걸리는 컨슈머에서 손댈 값은 `session.timeout.ms`가 아니라 이쪽 둘이다. `max.poll.interval.ms`를 늘리거나, `max.poll.records`를 줄여 한 번에 받는 양을 깎는다. 기본값이 500이므로 한 건에 1초 걸리는 처리라면 한 묶음을 비우는 데 8분이 든다.

## poll의 인자는 sleep이 아니다

`Duration.ofMillis(1000)`은 최대 대기 시간이다. 가져올 게 없을 때만 그 시간까지 기다리고, 버퍼에 레코드가 있으면 즉시 리턴한다. 무한 루프가 초당 한 바퀴 도는 것이 아니라 데이터가 들어오는 만큼 돈다.

기다리는 층이 하나 더 있다. 브로커도 fetch 요청을 곧바로 처리하지 않고, `fetch.min.bytes`만큼 쌓이거나 `fetch.max.wait.ms`가 차기를 기다린다. 기본값 1바이트에서는 레코드가 하나만 있어도 곧바로 응답한다. `max.poll.records`가 자르는 것은 브로커에서 가져오는 양이 아니라 `poll`이 한 번에 건네주는 양이라, 버퍼에 그보다 많이 들어 있으면 다음 `poll`은 네트워크에 나가지 않고 남은 것을 꺼내 준다. 브로커가 언제 얼마를 보내는지와 그 사이의 큐는 [컨슈머 fetch](/posts/kafka-consumer-fetch)에서 다룬다.

## close가 안 불리면 45초가 남는다

`close()`는 두 가지를 한다. 자동 커밋이 켜져 있으면 마지막 진행 위치를 동기로 커밋하고, 그다음 LeaveGroup을 보내 그룹에서 명시적으로 빠진다. LeaveGroup이 도착하면 코디네이터가 곧바로 [리밸런싱](/posts/kafka-basics)을 시작해 남은 컨슈머들에 파티션을 넘긴다.

이것이 생략되면 브로커는 그 멤버가 아직 있다고 본다. `session.timeout.ms` 45초가 지나 heartbeat 부재가 확정될 때까지 파티션이 그 멤버에게 배정된 채 남는다. 그 사이에 컨슈머를 다시 띄우면 새 멤버가 합류를 시도하는데 이전 멤버 자리가 정리되지 않은 상태라, 기동 로그에 재합류 시도가 반복해 찍힌다.

무한 루프 안에서는 `close()`에 닿을 길이 없다. `while (true)` 아래에 적어 둔 문장은 도달하지 않고, try-with-resources도 블록을 벗어나야 닫히므로 예외가 밖으로 나가지 않는 한 돌지 않는다. IDE의 정지 버튼이나 `SIGTERM`은 JVM을 내리는 신호라 루프를 빠져나오게 만들지 못한다.

빠져나오는 수단이 `wakeup()`이다. 다른 스레드에서 부르면 `poll`에 붙잡혀 있던 스레드가 `WakeupException`을 받고 튀어나오므로, 그 예외를 잡아 `finally`에서 닫는다.

```java
KafkaConsumer<String, String> kafkaConsumer = new KafkaConsumer<>(properties);
Thread mainThread = Thread.currentThread();

Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    kafkaConsumer.wakeup();
    try {
        mainThread.join();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
}));

try {
    kafkaConsumer.subscribe(List.of(topicName));

    while (true) {
        ConsumerRecords<String, String> records = kafkaConsumer.poll(Duration.ofMillis(1000));
        // 처리
    }
} catch (WakeupException e) {
    logger.info("wakeup 으로 poll 루프를 빠져나왔다");
} finally {
    kafkaConsumer.close();
}
```

`wakeup()`은 컨슈머의 메서드 중 유일하게 다른 스레드에서 불러도 되는 것이다. 나머지를 다른 스레드에서 부르면 `ConcurrentModificationException`으로 막히므로, 종료 신호를 넣을 자리가 여기뿐이다.

훅이 `wakeup()`만 부르고 반환하면 커밋과 LeaveGroup이 나가지 못한다. JVM은 등록된 훅 스레드가 전부 끝나면 종료하는데, 메인 스레드는 그때 `poll`에서 막 빠져나와 `close()`에 들어간 참이다. 훅이 `mainThread.join()`으로 메인 스레드의 종료를 기다려야 `close()`가 끝까지 돌고, 그래야 위에서 본 45초를 실제로 피한다. `Thread.currentThread()`를 훅 바깥에서 잡아 두는 것도 같은 이유다 - 훅 안에서 부르면 메인 스레드가 아니라 훅 스레드 자신이 잡힌다.

## 이 배치는 group.protocol이 classic일 때다

Kafka 4.0부터 컨슈머 그룹 프로토콜을 고를 수 있다. `group.protocol`을 `consumer`로 두면 구현이 `AsyncKafkaConsumer`로 바뀌고 스레드 배치가 뒤집힌다 — `ConsumerNetworkThread`가 네트워크 I/O와 heartbeat를 모두 맡고, 애플리케이션 스레드의 `poll`은 이벤트 큐에서 완료된 fetch를 꺼내 온다.

| 설정 | 고를 수 있는 값 | 기본값 (4.2.1) |
|---|---|---|
| `group.protocol` | `classic` · `consumer` | `classic` |

4.2.1의 기본값이 `classic`이라, 설정을 건드리지 않은 컨슈머는 위에서 본 배치로 돈다. [새 프로토콜](/posts/kafka-consumer-rebalance-kip848)은 파티션 할당도 클라이언트가 아니라 브로커가 계산하고, `session.timeout.ms`·`heartbeat.interval.ms`도 클라이언트 설정에서 브로커 설정으로 옮겨간다. 어느 프로토콜로 도는지 모른 채 타임아웃을 조정하면 클라이언트에 적은 값이 아무 일도 하지 않을 수 있다.

---

프로듀서와 컨슈머는 스레드를 반대로 쓴다. 프로듀서는 `send()`가 배치에 넣고 빠지며 전송을 [백그라운드에 맡기고](/posts/kafka-java-producer-internals), 컨슈머는 `poll`을 부른 스레드가 가져오는 일까지 직접 한다. 컨슈머의 백그라운드 스레드가 맡은 것은 살아있다는 신고와, 그 신고가 거짓이 되지 않게 `poll` 간격을 감시하는 일뿐이다.

그래서 컨슈머의 타임아웃은 전부 그 스레드가 언제 돌아오는지를 재고 있다. `poll`이 언제 리턴하는지, 다음 `poll`이 언제 오는지, 마지막 `poll` 뒤에 `close`가 불렸는지. 루프를 한 바퀴 늦게 돌면 파티션을 잃고, 루프를 못 빠져나오면 45초가 남는다.
