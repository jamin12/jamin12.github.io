# Spring Data Redis의 Streams 추상화

## StreamMessageListenerContainer

Spring Data Redis는 `StreamMessageListenerContainer`를 통해 백그라운드 polling을 처리한다.

```kotlin
val options = StreamMessageListenerContainer
  .StreamMessageListenerContainerOptions
  .builder()
  .pollTimeout(Duration.ofSeconds(1))
  .build()

val container = StreamMessageListenerContainer.create(connectionFactory, options)
container.start()
```

`pollTimeout`은 polling 주기를 의미한다. 1초로 설정하면 1초마다 Redis에 새 메시지를 확인한다.

Container가 시작되면 백그라운드 스레드가 다음과 같이 동작한다.

```
while (true) {
  sleep(pollTimeout)
  XREADGROUP ... (등록된 Listener에 대해)
  if (메시지 있음) {
    콜백 실행
  }
}
```

하나의 Container에 여러 Listener를 등록할 수 있다. 각 Listener는 독립적으로 polling된다.

## Consumer.from()

`Consumer.from(groupName, consumerName)`은 Redis의 `GROUP`과 Consumer 이름을 지정한다.

```kotlin
Consumer.from("notification-service", "server-1")
```

Redis 명령어로 변환:

```bash
XREADGROUP GROUP notification-service server-1 ...
```

멀티 인스턴스 환경에서 각 서버를 구분하기 위해 Consumer 이름을 자동 생성할 수 있다.

```kotlin
val consumerName = "${InetAddress.getLocalHost().hostName}-${System.currentTimeMillis()}"
Consumer.from("notification-service", consumerName)
// → Consumer.from("notification-service", "MacBook-1737284567890")
```

## StreamOffset.create()

`StreamOffset.create(streamKey, readOffset)`은 어느 Stream의 어디서부터 읽을지 지정한다.

```kotlin
StreamOffset.create("order-events", ReadOffset.lastConsumed())
```

Redis 명령어로 변환:

```bash
STREAMS order-events >
```

`ReadOffset`에는 세 가지 종류가 있다.

### lastConsumed() → ">"

```kotlin
StreamOffset.create("orders", ReadOffset.lastConsumed())

// Redis 명령어:
// STREAMS orders >
```

Offset 다음부터 읽는다. 일반적으로 사용하는 방식이다.

### latest() → "$"

```kotlin
StreamOffset.create("notifications", ReadOffset.latest())

// Redis 명령어:
// STREAMS notifications $
```

지금부터 새로 들어오는 메시지만 읽는다. 과거 메시지는 무시한다.

### from(messageId)

```kotlin
StreamOffset.create("orders", ReadOffset.from("1737284567890-0"))

// Redis 명령어:
// STREAMS orders 1737284567890-0
```

특정 ID 이후부터 읽는다.

## MapRecord

메시지는 `MapRecord<String, String, String>` 타입으로 전달된다.

```kotlin
record.stream      // "order-events"
record.id          // RecordId("1737284567890-0")
record.value       // Map<String, String>
```

Redis에 저장된 형태가 다음과 같다면:

```bash
XADD order-events * payload '{"@class":"OrderCreatedEvent","orderId":"123"}'
```

`record.value`는 이렇게 전달된다.

```kotlin
Map("payload" -> '{"@class":"OrderCreatedEvent","orderId":"123"}')
```

"payload" 키에서 JSON을 추출해서 역직렬화한다.

## receiveAutoAck()

`receiveAutoAck()`는 메시지를 읽고 콜백을 실행한 후 자동으로 ACK를 보낸다.

```kotlin
container.receiveAutoAck(
  Consumer.from("notification-service", "server-1"),
  StreamOffset.create("order-events", ReadOffset.lastConsumed())
) { record ->
  handleMessage(record)
}
```

내부 동작:

```
1. XREADGROUP GROUP notification-service server-1
   COUNT 10 BLOCK 1000 STREAMS order-events >
2. 메시지 받음
3. 콜백 실행: handleMessage(record)
4. 성공 시: XACK order-events notification-service <msg-id>
5. 실패 시: ACK 안 함 (Pending 유지)
```

실패 시 ACK를 보내지 않으므로 Pending 상태로 남는다. 이후 `XREADGROUP ... 0`으로 재처리할 수 있다.

## Redis 명령어 매핑

전체 흐름:

```kotlin
container.receiveAutoAck(
  Consumer.from("notification-service", "MacBook-123"),
  StreamOffset.create("order-events", ReadOffset.lastConsumed())
) { record ->
  processMessage(record)
}
```

Redis 명령어 변환:

```bash
# 1초마다 실행 (pollTimeout)
XREADGROUP GROUP notification-service MacBook-123
  COUNT 10
  BLOCK 1000
  STREAMS order-events >

# 성공 시
XACK order-events notification-service <msg-id>
```

## 멀티 인스턴스 환경

3대 서버에서 동일한 코드를 실행하는 경우:

```kotlin
@ValkeyListener(
  stream = "order-events",
  consumerGroup = "notification-service"
)
fun sendEmail(event: OrderCreatedEvent) { }
```

각 서버는 다음과 같이 동작한다.

```
Server 1:
Consumer.from("notification-service", "MacBook-1-1737284567890")
→ XREADGROUP GROUP notification-service MacBook-1-... STREAMS order-events >

Server 2:
Consumer.from("notification-service", "MacBook-2-1737284567891")
→ XREADGROUP GROUP notification-service MacBook-2-... STREAMS order-events >

Server 3:
Consumer.from("notification-service", "MacBook-3-1737284567892")
→ XREADGROUP GROUP notification-service MacBook-3-... STREAMS order-events >
```

같은 그룹이지만 다른 Consumer 이름이므로 메시지가 자동으로 분산된다.

## receiveAutoAck vs receive

`receive()`는 수동 ACK를 제어한다.

```kotlin
container.receive(consumer, offset) { record ->
  try {
    handleMessage(record)

    // 수동 ACK
    redisTemplate.opsForStream<String, String>()
      .acknowledge("order-events", "notification-service", record.id)
  } catch (e: Exception) {
    // ACK 안 함 (Pending 유지)
  }
}
```

`receiveAutoAck()`는 간단하지만 세밀한 제어가 어렵다. 조건부 ACK가 필요한 경우 `receive()`를 사용할 수 있다.

## 관찰

Spring Data Redis가 제공하는 추상화:

- `StreamMessageListenerContainer`: 백그라운드 polling 담당
- `Consumer.from()`: 그룹+이름 지정
- `StreamOffset.create()`: Stream+시작위치 지정
- `MapRecord`: 메시지 데이터
- `receiveAutoAck()`: 콜백+자동 ACK

이러한 추상화를 통해 Redis CLI 수준의 명령어를 직접 다루지 않고도 Streams를 사용할 수 있다. 내부 동작을 이해하려면 Redis 명령어와의 매핑을 파악하는 것이 중요하다.
