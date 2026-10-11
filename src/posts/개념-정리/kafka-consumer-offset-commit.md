---
title: Kafka 컨슈머 오프셋 커밋
date: 2026-10-11
tags: [kafka, consumer-group, java, offset]
summary: 자동 커밋의 실행 시점과 수동 커밋의 대기, 실패 처리가 재시작 뒤의 중복과 누락을 가른다
---

## 읽기 위치와 커밋 위치

커밋은 [내부 토픽 `__consumer_offsets`](/posts/kafka-consumer-offsets-topic)에 그룹, 토픽, 파티션별로 진행 위치를 저장한다. 파티션마다 독립된 로그를 읽으므로 커밋 값도 파티션마다 다르다.

값은 **다음에 읽을 offset**이다. offset 0, 1, 2를 처리했다면 3을 저장한다. 컨슈머가 재시작하거나 파티션을 새로 배정받으면 저장된 위치부터 읽기를 시작한다.

커밋된 위치가 30이고 `poll`로 30~49를 받았다면 메모리의 읽기 위치는 50이다. 새로 커밋하기 전까지 브로커에 저장된 위치는 30으로 남는다.

[컨슈머 Lag](/posts/kafka-consumer-lag)의 기준도 커밋된 위치다. 처리는 되고 있는데 커밋이 밀려 있으면 그 분량이 Lag으로 잡힌다.

## 자동 커밋의 실행 시점

`group.protocol=classic`인 Java 컨슈머는 `poll` 안에서 시간을 확인해 자동 커밋 요청을 보낸다. 별도의 heartbeat 스레드는 그룹의 생존을 알리고, 커밋은 애플리케이션이 도는 [poll 루프](/posts/kafka-consumer-poll-loop)가 진행시킨다.

| 설정 | 하는 일 | 기본값 (4.2.1) |
|---|---|---|
| `enable.auto.commit` | 진행 위치를 자동으로 커밋한다 | `true` |
| `auto.commit.interval.ms` | 자동 커밋의 최소 간격 | `5000` |

`auto.commit.interval.ms`가 5초여도 `poll`을 부르지 않으면 classic 컨슈머의 자동 커밋 요청은 나가지 않는다. `group.protocol=consumer`의 네트워크 작업은 백그라운드 스레드가 맡으므로, 자동 커밋이 실행되는 스레드와 시점은 프로토콜에 따라 다르다.

자동 커밋은 애플리케이션의 처리 완료를 확인하지 않고 `poll`로 건네준 위치를 저장한다. 받은 레코드를 전부 처리한 뒤 다음 `poll`을 부르는 루프에서는 처리 도중에 죽으면 마지막 커밋 이후의 레코드를 다시 받는다. 간격이 안 지난 `poll`은 커밋하지 않아서 그 분량이 여러 묶음에 걸쳐 쌓일 수도 있다.

처리를 다른 스레드에 넘기고 곧바로 다음 `poll`을 부르면, 아직 처리하지 않은 레코드의 위치까지 커밋될 수 있다. 자동 커밋을 켠 `close()`에서도 마지막 위치를 커밋하므로 종료 전에 처리 완료를 확인해야 한다. [Kafka의 자동 커밋 예제](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)는 다음 `poll`이나 종료 전에 반환된 레코드를 모두 처리하는 조건을 둔다.

## 처리와 커밋의 순서

수동으로 커밋하려면 컨슈머를 만들기 전에 자동 커밋을 끈다.

```java
properties.setProperty(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
```

처리와 커밋 사이에는 프로세스가 죽을 수 있는 구간이 남는다.

| 순서 | 장애 시점 | 재시작 뒤 결과 |
|---|---|---|
| 처리 후 커밋 | 처리는 끝났지만 커밋 전 | 이미 처리한 레코드를 다시 받아 중복 처리 |
| 커밋 후 처리 | 커밋은 끝났지만 처리 중 | 저장된 위치 이전의 미처리 레코드를 건너뛰어 누락 |

offset 0~99를 받아 100을 먼저 커밋하고 40건을 처리한 뒤 죽으면, 재시작은 100부터다. 남은 60건은 처리되지 않은 채 건너뛴다. 처리 후 커밋하는 방식에서도 DB 반영이 끝나고 커밋 전에 죽으면 같은 DB 작업을 다시 하게 되므로, 외부 저장소의 중복 처리를 막을 방법은 따로 필요하다.

## 동기 커밋의 대기와 실패

받은 묶음을 전부 처리한 뒤 `commitSync()`를 부르면, 그 묶음의 다음 읽기 위치를 커밋한다. 다음 코드는 `process(record)`가 반환될 때 해당 레코드의 처리도 끝나는 루프다.

```java
while (true) {
    ConsumerRecords<String, String> records =
        kafkaConsumer.poll(Duration.ofMillis(1000));

    for (ConsumerRecord<String, String> record : records) {
        process(record);
    }

    if (!records.isEmpty()) {
        kafkaConsumer.commitSync();
    }
}
```

`commitSync()`는 응답을 기다리는 동안 호출한 스레드를 붙잡는다. 정상 반환 뒤에 다음 `poll`을 부르므로 커밋의 왕복 시간이 루프 한 바퀴에 더해진다.

재시도 가능한 오류는 내부에서 재시도하지만 대기에는 끝이 있다. [동기 커밋 API](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html#commitSync())는 커밋 성공, 복구 불가능한 오류, `default.api.timeout.ms` 만료 중 하나로 종료된다. 시간을 직접 지정하는 `commitSync(Duration)`도 있다.

타임아웃이 만료되면 `TimeoutException`, 그룹에서 빠져 담당 파티션을 잃었다면 `CommitFailedException` 등이 호출자에게 전달된다. 커밋 예외를 잡고 루프를 계속 돌지, 처리를 중단할지는 애플리케이션이 정한다. 예외를 무시하고 진행하면 처리한 위치와 저장된 위치의 차이가 계속 커질 수 있다.

## 비동기 커밋과 결과 확인

`commitAsync()`는 커밋 완료를 기다리지 않고 반환한다. 처리 완료 뒤 요청을 넣고 다음 `poll`로 진행할 수 있어 매 묶음마다 커밋 응답을 기다리는 시간을 줄인다.

```java
while (true) {
    ConsumerRecords<String, String> records =
        kafkaConsumer.poll(Duration.ofMillis(1000));

    for (ConsumerRecord<String, String> record : records) {
        process(record);
    }

    if (!records.isEmpty()) {
        kafkaConsumer.commitAsync((offsets, exception) -> {
            if (exception != null) {
                logger.error("offset commit failed: {}", offsets, exception);
            }
        });
    }
}
```

콜백의 `exception`이 `null`이면 커밋 성공이고, 값이 있으면 실패다. [비동기 커밋 API](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html#commitAsync(org.apache.kafka.clients.consumer.OffsetCommitCallback))는 콜백을 주지 않으면 커밋 결과로 전달되는 오류를 버린다. 이 코드는 실패를 기록하고, 실패한 과거 위치를 다시 커밋하지 않는다.

classic 컨슈머에서 비동기 커밋은 애플리케이션이 컨슈머 API를 호출하며 네트워크 작업을 진행하는 방식이다. `commitAsync`의 비동기는 완료 대기를 생략하는 API 동작이고, 백그라운드 스레드가 모든 일을 대신한다는 스레드 구조와는 별개다.

Kafka 4.2.1의 classic 구현은 실패한 비동기 커밋 요청을 자동으로 재시도하지 않는다. [ConsumerCoordinator](https://github.com/apache/kafka/blob/4.2.1/clients/src/main/java/org/apache/kafka/clients/consumer/internals/ConsumerCoordinator.java)의 `doCommitOffsetsAsync`는 재시도 가능한 오류도 콜백으로 넘긴다. 동기 커밋은 같은 클래스의 `commitOffsetsSync`에서 타임아웃 안에 재시도한다.

커밋이 실패해도 실행 중인 컨슈머의 읽기 위치는 되돌아가지 않는다. 다음 묶음의 더 최신 위치를 성공적으로 커밋하면 이전 실패 지점까지 포함해 진도가 저장되지만, 그때까지는 재시작 때 다시 읽을 범위가 남는다.

## 과거 오프셋을 재시도할 때의 역행

같은 파티션에서 200을 커밋하려던 요청이 실패한 뒤, 처리를 계속해 240 커밋이 성공할 수 있다. 애플리케이션이 실패한 200을 나중에 다시 제출하면 저장된 위치가 되돌아갈 수 있다.

| 순서 | 커밋 요청 | 결과 | 저장된 위치 |
|---|---|---|---|
| 1 | 200 | 실패 | 이전 값 유지 |
| 2 | 240 | 성공 | 240 |
| 3 | 애플리케이션이 200 재제출 | 성공 | 200 |

Kafka는 같은 클라이언트의 `commitAsync` 호출 순서대로 요청을 보내고 콜백도 같은 순서로 호출한다. 역행은 애플리케이션이 과거 값을 새 요청으로 다시 제출할 때 생긴다. 커밋 값은 해당 키의 최신 기록으로 저장되므로, 더 작은 값도 마지막 요청으로 반영될 수 있다.

실패 콜백이 받은 offset 맵을 그대로 재제출하는 로직은 이 순서를 고려해야 한다. 최신 처리 위치를 커밋하거나 파티션별로 오래된 재시도를 막아야 하고, 어느 경우든 아직 처리하지 않은 위치까지 올려서는 안 된다.

## auto.offset.reset과 시작 위치

파티션을 배정받으면 컨슈머는 저장된 커밋 위치를 조회한다. 새 `group.id`이거나 기록이 만료돼 위치가 없을 때 `auto.offset.reset`으로 시작점을 정한다. 저장된 위치가 데이터 보존 때문에 로그 범위를 벗어난 경우에도 이 설정을 적용한다.

`earliest`는 남아 있는 가장 오래된 위치부터, 기본값인 `latest`는 현재 로그 끝부터 읽는다. 메시지 세 건이 있는 새 파티션에 `latest`로 새 그룹이 붙으면 읽기 위치는 3이 되고, 쌓여 있는 0, 1, 2를 건너뛴다. 기동 로그에는 `Resetting offset for partition`으로 시작하는 줄이 남는다.

유효한 커밋 위치가 있으면 그 값부터 읽는다. `earliest`로 바꿔 재시작해도 이미 저장된 진도가 3이면 0부터 다시 읽지 않는다. 과거 레코드를 다시 읽으려면 그룹의 커밋 위치를 재설정하거나, [`seek()`로 실행 중인 컨슈머의 읽기 위치를 명시적으로 바꿔야 한다](/posts/kafka-consumer-replay).
