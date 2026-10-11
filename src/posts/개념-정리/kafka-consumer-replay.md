---
title: Kafka 컨슈머의 파티션 수동 할당과 재조회
date: 2026-10-11
tags: [kafka, consumer-group, java, offset]
summary: assign으로 파티션을 직접 고르고 seek로 시작 위치를 지정해, 기존 그룹의 커밋을 바꾸지 않고 정해진 범위를 다시 읽는다
---

## 파티션 직접 할당

`assign()`은 컨슈머가 읽을 파티션 목록을 직접 지정한다. `TopicPartition`에 토픽 이름과 파티션 번호를 넣고 컬렉션으로 넘긴다.

```java
TopicPartition partition = new TopicPartition("orders", 1);
kafkaConsumer.assign(List.of(partition));
```

이 컨슈머는 `orders`의 1번 파티션만 읽는다. 파티션 여러 개를 맡기려면 `List.of(partition0, partition1)`처럼 함께 넘긴다. `List.of()`는 객체도 받을 수 있어 `Arrays.asList()`로 바꿀 필요가 없다.

| 구분 | `subscribe()` | `assign()` |
|---|---|---|
| 지정하는 대상 | 토픽 이름 | 토픽과 파티션 번호 |
| 배정을 결정하는 주체 | 컨슈머 그룹의 배정 절차 | 애플리케이션 |
| 멤버 추가와 장애에 따른 재배정 | 그룹이 수행 | 애플리케이션이 관리 |
| 같은 그룹에서 같은 파티션 읽기 | 자동 배정에 참여한 멤버 중 하나에 배정 | 각 컨슈머가 독립적으로 읽을 수 있음 |

[Kafka의 수동 할당 문서](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html#assign(java.util.Collection))에 따르면 `assign()`은 그룹의 배정 절차에 참여하지 않는다. 같은 `group.id`로 실행해도 읽을 파티션을 나눠 갖지 않으며, 컨슈머 하나가 죽어도 다른 컨슈머로 자동 인계되지 않는다.

`subscribe()`로 구독하던 컨슈머를 `assign()` 방식으로 전환하려면 `unsubscribe()`로 기존 구독을 해제해야 한다. 특정 파티션의 재조회 작업에서는 `subscribe()` 대신 `assign()`을 사용한다.

### 수동 할당과 자동 배정의 공존

수동 할당한 파티션도 그룹의 자동 배정 대상에 그대로 포함된다. `assign()`으로 읽는 컨슈머는 배정 절차 밖에서 동작하므로, 그룹은 그 컨슈머가 읽는 파티션을 예약하거나 배정 대상에서 제외하지 않는다.

`orders`에 P0, P1, P2가 있고 A, B, C가 같은 `group.id`를 사용한다면, 다음과 같은 배정이 가능하다.

| 컨슈머 | 읽는 방식 | 읽을 파티션 |
|---|---|---|
| A | `assign(P0)` | 애플리케이션이 지정한 P0 |
| B | `subscribe("orders")` | 그룹이 배정한 P0, P1 |
| C | `subscribe("orders")` | 그룹이 배정한 P2 |

자동 배정에 참여하는 멤버는 B와 C이고, 그룹은 P0, P1, P2 전체를 둘에게 나눠 준다. A와 B는 P0의 같은 레코드를 각각 읽을 수 있다. 한 파티션을 한 멤버에게 배정하는 제약은 자동 배정에 참여한 멤버 사이에 적용된다.

이 배정은 컨슈머가 어디를 읽을지 정하는 작업이다. 프로듀서가 메시지를 어느 파티션에 넣을지 정하는 파티셔닝은 `assign()`의 영향을 받지 않는다.

## seek로 시작 위치 지정

`seek()`는 이미 할당된 파티션의 읽기 위치를 바꾼다. `assign()` 직후에 부르면 그룹 합류를 위한 첫 `poll()` 없이 시작 위치를 지정할 수 있다.

```java
TopicPartition partition = new TopicPartition("orders", 1);
kafkaConsumer.assign(List.of(partition));
kafkaConsumer.seek(partition, 5L);
```

offset의 타입은 `long`이다. `5L`은 그 타입을 명시한 리터럴이고, `seek(partition, 5)`도 Java가 `int`를 `long`으로 변환해 받는다. 파티션 번호는 `int`다.

이후 `poll()`은 1번 파티션의 offset 5부터 읽는다. 저장된 커밋 위치가 100이어도 실행 중인 읽기 위치는 5로 지정된다. 이미 처리한 레코드라도 로그에 남아 있으면 다시 받을 수 있다.

`seek()`가 바꾸는 것은 컨슈머의 읽기 위치다. 브로커에 저장된 [커밋 위치](/posts/kafka-consumer-offset-commit)는 별도의 커밋 요청이 있을 때 바뀐다.

`subscribe()`로 배정받은 파티션에도 `seek()`를 쓸 수 있지만, 파티션을 배정받은 뒤에 호출해야 한다. 리밸런싱 후에도 위치를 다시 지정해야 한다면 `ConsumerRebalanceListener.onPartitionsAssigned()`에서 처리한다.

## 로그 범위를 벗어난 시작 위치

`seek()`에 지정한 번호가 현재 읽을 수 있는 범위 안에 있어야 한다. `beginningOffsets()`는 남아 있는 로그의 시작 위치를, `endOffsets()`는 로그 끝 위치를 조회한다.

```java
long beginning = kafkaConsumer.beginningOffsets(List.of(partition)).get(partition);
long end = kafkaConsumer.endOffsets(List.of(partition)).get(partition);
```

끝 위치는 마지막 레코드의 다음 자리다. offset 0~9가 남아 있으면 시작은 0, 끝은 10이다. 10으로 `seek()`하면 이후 들어올 레코드를 기다릴 수 있고, 11은 현재 범위를 벗어난다. 데이터 보존으로 0~4가 지워졌다면 시작은 5로 올라간다.

[seek API](https://kafka.apache.org/42/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html#seek(org.apache.kafka.common.TopicPartition,long))는 범위를 벗어난 위치를 읽을 때 `auto.offset.reset`에 따라 처리한다.

| 설정값 | 범위를 벗어난 위치의 처리 |
|---|---|
| `earliest` | 남아 있는 로그의 시작으로 이동 |
| `latest` | 현재 로그 끝으로 이동 |
| `none` | `OffsetOutOfRangeException` 발생 |

offset 10에서 시작하려는데 빈 파티션의 끝 위치가 0이면, `earliest` 설정에서는 0으로 이동한다. 이후 레코드를 0부터 읽는 것은 범위 재설정의 결과다. 미리 커밋된 값 때문에 명시한 `seek()`가 무시된 것이 아니다.

컴팩션 등으로 로그 중간의 특정 번호가 비어 있을 수도 있다. 범위 안의 offset 5에 레코드가 없고 다음 레코드가 8이면, 8부터 반환될 수 있다. 레코드 개수와 offset 차이가 항상 같지는 않다.

## 재조회와 그룹의 커밋

DB 반영에 실패했는데 컨슈머가 커밋까지 마쳤다면, 누락된 데이터의 파티션과 offset을 찾아 다시 처리할 수 있다. 이 작업에서 커밋도 수행하면 [내부 토픽 `__consumer_offsets`](/posts/kafka-consumer-offsets-topic)에 같은 그룹, 토픽, 파티션의 위치를 저장한다.

수동 할당은 읽기 배정을 독립시킬 뿐, `group.id`로 구분하는 커밋 저장 공간까지 분리하지는 않는다. 운영 그룹과 같은 이름으로 재조회하면서 커밋하면 운영 컨슈머가 이어 읽을 진도를 바꿀 수 있다. 활성 그룹의 상태에 따라 커밋이 거절될 수도 있으므로, 재조회 작업의 저장 공간은 별도로 잡는다.

| 재조회 방식 | 설정과 호출 |
|---|---|
| 진행 위치를 저장하지 않음 | `enable.auto.commit=false`, 커밋 API 호출 생략, `group.id` 생략 가능 |
| 재조회 작업의 진행 위치를 저장 | 별도 `group.id` 사용, 처리 완료 뒤 커밋 |

`group.id` 없이 읽으려면 `assign()`과 명시적인 시작 위치를 사용하고 자동 커밋을 꺼야 한다. 운영 컨슈머의 설정 객체를 그대로 재사용하기보다 재조회용 설정을 따로 만든다.

재조회에서 DB에 다시 쓰는 작업은 중복 실행될 수 있다. 레코드의 파티션과 offset이나 업무 식별자를 기준으로 이미 반영된 데이터를 구분할 수 있어야 한다.

## 끝 위치를 정한 재조회 코드

offset 5 이상, 10 미만만 읽는 코드다. `group.id`를 설정하지 않고 자동 커밋을 끈다. `auto.offset.reset=none`으로 지정해 작업 중 데이터 보존으로 시작 위치가 사라지면 오류로 끝나게 한다.

```java
Properties properties = new Properties();
properties.setProperty(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
properties.setProperty(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
    StringDeserializer.class.getName());
properties.setProperty(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
    StringDeserializer.class.getName());
properties.setProperty(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, "false");
properties.setProperty(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "none");

TopicPartition partition = new TopicPartition("orders", 1);
long startOffset = 5L;
long stopOffset = 10L;

try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(properties)) {
    consumer.assign(List.of(partition));

    long beginning = consumer.beginningOffsets(List.of(partition)).get(partition);
    long end = consumer.endOffsets(List.of(partition)).get(partition);
    if (startOffset < beginning || startOffset >= stopOffset || stopOffset > end) {
        throw new IllegalArgumentException("재조회 범위가 로그 범위를 벗어남");
    }

    consumer.seek(partition, startOffset);
    long startedAt = System.nanoTime();
    long timeLimit = Duration.ofMinutes(5).toNanos();

    while (consumer.position(partition) < stopOffset) {
        if (System.nanoTime() - startedAt >= timeLimit) {
            throw new IllegalStateException("재조회 제한 시간 초과");
        }

        ConsumerRecords<String, String> records =
            consumer.poll(Duration.ofSeconds(1));

        for (ConsumerRecord<String, String> record : records.records(partition)) {
            if (record.offset() >= stopOffset) {
                break;
            }
            System.out.printf("partition=%d offset=%d key=%s value=%s%n",
                record.partition(), record.offset(), record.key(), record.value());
        }
    }
}
```

`poll()`은 지정한 끝 위치보다 뒤의 레코드까지 한 번에 반환할 수 있다. 그래서 반복문의 종료 조건뿐 아니라 받은 레코드에도 `stopOffset` 검사를 둔다. offset 10 이후가 같은 묶음에 들어와도 출력하지 않는다.

빈 `poll()`은 잠깐 데이터가 없거나 응답을 기다린 결과일 수 있어 완료 조건으로 쓰지 않는다. 종료는 `position()`이 끝 위치에 도달했는지로 판단하고, 읽기가 진행되지 않는 경우를 위해 예제에는 5분의 루프 제한 시간을 둔다. 메타데이터 조회나 네트워크 호출 자체의 타임아웃은 별도로 적용된다.

작업 시작 시점까지 쌓인 데이터를 전부 읽으려면 `stopOffset`을 최초 `endOffsets()` 조회값으로 고정한다. 끝 위치를 매번 다시 조회하면 새로 들어오는 데이터까지 범위가 늘어나 작업이 끝나지 않을 수 있다. 이 경계는 조회 범위만 고정하며, 작업 중 로그 삭제나 컴팩션까지 막아 주지는 않는다.
