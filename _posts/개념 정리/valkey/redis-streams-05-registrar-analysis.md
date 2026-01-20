# ValkeyListenerRegistrar 구현 분석

## 개요

`@ValkeyListener` 어노테이션 기반 메시지 수신 구조다. Spring의 `@EventListener`와 유사하게 동작한다.

```kotlin
@Component
class OrderEventListener {
  @ValkeyListener(
    stream = "order-events",
    consumerGroup = "notification-service"
  )
  fun sendEmail(event: OrderCreatedEvent) {
    // 메시지 처리
  }
}
```

## SmartInitializingSingleton

`ValkeyListenerRegistrar`는 `SmartInitializingSingleton` 인터페이스를 구현한다.

```kotlin
@Component
class ValkeyListenerRegistrar(
  private val applicationContext: ApplicationContext,
  private val connectionFactory: RedisConnectionFactory,
  private val redisTemplate: RedisTemplate<String, RedisStorable>,
) : SmartInitializingSingleton
```

이 인터페이스는 모든 빈이 초기화된 후 `afterSingletonsInstantiated()` 메서드를 호출한다.

Spring 시작 과정:
1. 빈 정의 읽기
2. 빈 생성
3. 의존성 주입
4. @PostConstruct 실행
5. SmartInitializingSingleton.afterSingletonsInstantiated() 실행

모든 빈이 준비된 시점에서 `@ValkeyListener`를 스캔한다.

## Container 생성 및 시작

`afterSingletonsInstantiated()` 첫 부분에서 Container를 생성하고 시작한다.

```kotlin
val containerOptions =
  StreamMessageListenerContainer
    .StreamMessageListenerContainerOptions
    .builder()
    .pollTimeout(Duration.ofSeconds(1))
    .build()

val container = StreamMessageListenerContainer.create(connectionFactory, containerOptions)
container.start()
```

`pollTimeout`을 1초로 설정한다. 백그라운드 스레드가 1초마다 Redis에 새 메시지를 확인한다.

## 빈 스캔

모든 빈을 순회하며 `@ValkeyListener`가 붙은 메서드를 찾는다.

```kotlin
applicationContext.beanDefinitionNames.forEach { beanName ->
  val bean = applicationContext.getBean(beanName)

  bean::class.java.methods.forEach { method ->
    val ann = method.getAnnotation(ValkeyListener::class.java) ?: return@forEach

    // Listener 등록 로직
  }
}
```

일부 빈은 `getBean()` 실패할 수 있어서 예외를 무시하도록 처리한다.

## 메서드 시그니처 검증

Listener 메서드는 파라미터가 정확히 1개여야 한다.

```kotlin
private fun validateMethodSignature(method: Method, beanName: String) {
  if (method.parameterCount != 1) {
    throw InvalidValkeyListenerException(
      "@ValkeyListener method $beanName.${method.name} must have exactly one parameter"
    )
  }

  if (method.returnType != Void.TYPE) {
    logger.warn("should return Unit, but returns ${method.returnType.simpleName}")
  }
}
```

반환 타입은 `Unit`이 권장되지만, 경고만 출력하고 진행된다.

파라미터 타입이 `RedisStorable`을 구현하는지도 확인한다.

```kotlin
val paramType = method.parameterTypes.first()
val kotlinClass = paramType.kotlin

if (!kotlinClass.isSubclassOf(RedisStorable::class)) {
  throw InvalidValkeyListenerException(
    "Parameter type ${paramType.name} must implement RedisStorable"
  )
}
```

## Consumer Group 생성

Stream 이름을 검증한 후 Consumer Group을 생성한다.

```kotlin
if (ann.stream.isBlank()) {
  throw InvalidValkeyListenerException("Stream name cannot be blank")
}

createConsumerGroupIfNotExists(ann.stream, ann.consumerGroup)
```

`createConsumerGroupIfNotExists()` 내부:

```kotlin
private fun createConsumerGroupIfNotExists(stream: String, group: String) {
  try {
    redisTemplate.opsForStream<String, Any>().createGroup(stream, group)
    logger.info("Created consumer group: stream=$stream, group=$group")
  } catch (e: Exception) {
    // 이미 존재하거나 Stream이 없으면 무시
    logger.debug("Consumer group already exists or stream not found")
  }
}
```

Redis 명령어:

```bash
XGROUP CREATE order-events notification-service 0
```

이미 존재하면 예외가 발생하지만 무시한다. 재시작 시에도 문제없이 동작한다.

## Consumer 이름 생성

Consumer 이름이 비어있으면 자동 생성한다.

```kotlin
val consumerName =
  ann.consumerName.ifBlank {
    "${InetAddress.getLocalHost().hostName}-${System.currentTimeMillis()}"
  }
```

예시:

```
"MacBook-Pro.local-1737284567890"
```

멀티 인스턴스 환경에서 각 서버를 구분할 수 있다.

## Listener 등록

Container에 Listener를 등록한다.

```kotlin
container.receiveAutoAck(
  Consumer.from(ann.consumerGroup, consumerName),
  StreamOffset.create(ann.stream, ReadOffset.lastConsumed()),
) { record ->
  handleStreamMessage(bean, method, record, paramType)
}
```

Redis 명령어로 변환:

```bash
XREADGROUP GROUP notification-service MacBook-1737284567890
  COUNT 10
  BLOCK 1000
  STREAMS order-events >
```

## 메시지 처리

`handleStreamMessage()`에서 실제 메시지를 처리한다.

```kotlin
private fun handleStreamMessage(
  bean: Any,
  method: Method,
  record: MapRecord<String, String, String>,
  paramType: Class<*>,
) {
  try {
    // 1. "payload" 필드 추출
    val payload = record.value["payload"]
      ?: throw IllegalArgumentException("Message must contain 'payload' field")

    // 2. valueSerializer 가져오기
    val serializer = redisTemplate.valueSerializer
      ?: throw IllegalStateException("valueSerializer is not configured")

    // 3. String → byte[] 변환
    val payloadBytes = payload.toByteArray(Charsets.UTF_8)

    // 4. 역직렬화
    val deserializedMessage = serializer.deserialize(payloadBytes)
      ?: throw IllegalArgumentException("Failed to deserialize message")

    // 5. 타입 체크
    if (!paramType.isInstance(deserializedMessage)) {
      throw IllegalArgumentException("Type mismatch")
    }

    // 6. 메서드 호출
    method.isAccessible = true
    method.invoke(bean, deserializedMessage)

  } catch (e: Exception) {
    logger.error("Failed to process stream message: ${e.message}", e)
    throw ValkeyMessageProcessingException(...)
  }
}
```

### payload 필드

메시지 저장 형식:

```bash
XADD order-events * payload '{"@class":"OrderCreatedEvent",...}'
```

`record.value`는 `Map("payload" -> "{...}")`이므로, "payload" 키에서 JSON을 추출한다.

### valueSerializer 재사용

`ValkeyConfig`에서 설정한 `Jackson2JsonRedisSerializer`를 재사용한다. `@class` 정보가 포함되어 있어서 타입을 복원할 수 있다.

```json
{
  "@class": "com.example.OrderCreatedEvent",
  "orderId": "123"
}
```

### 리플렉션 호출

`method.invoke(bean, deserializedMessage)`로 실제 Listener 메서드를 호출한다.

```kotlin
// 이것이 실행됨
orderEventListener.sendEmail(OrderCreatedEvent(orderId = "123"))
```

### 예외 처리

예외가 발생하면 `ValkeyMessageProcessingException`을 던진다. `receiveAutoAck`는 이 예외를 catch하고 ACK를 보내지 않는다. 메시지가 Pending 상태로 남아서 나중에 재처리할 수 있다.

## 전체 흐름

애플리케이션 시작부터 메시지 수신까지:

```
1. Spring Boot 시작
2. 모든 빈 생성
3. SmartInitializingSingleton.afterSingletonsInstantiated() 호출
4. Container 생성 및 시작
5. 모든 빈 스캔
6. @ValkeyListener 발견
7. 메서드 시그니처 검증
8. Consumer Group 생성 (XGROUP CREATE)
9. Listener 등록 (receiveAutoAck)
10. 백그라운드 polling 시작

[메시지 발행 시]
11. Container가 메시지 감지 (XREADGROUP)
12. handleStreamMessage() 실행
13. payload 추출
14. 역직렬화
15. 메서드 호출
16. 성공 시 ACK (XACK)
```

## 관찰

`ValkeyListenerRegistrar`의 역할:

- `@ValkeyListener` 어노테이션 스캔
- Consumer Group 자동 생성
- 메서드 시그니처 검증
- Container 기반 백그라운드 polling
- 메시지 역직렬화 및 메서드 호출
- 자동 ACK 처리

Spring의 이벤트 리스너와 유사한 방식으로 동작하지만, Redis Streams의 Consumer Group 개념을 통합했다. 멀티 인스턴스 환경에서 중복 처리 없이 메시지를 분산할 수 있다.

예외 발생 시 ACK를 보내지 않아서 Pending 상태로 남는다. 재처리 메커니즘을 별도로 구현할 수 있다.
