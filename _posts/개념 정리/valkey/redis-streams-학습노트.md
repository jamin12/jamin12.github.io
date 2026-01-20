# Redis Streams 학습 노트

## Level 1: Stream 기초

### 1.1 Stream이란?

Redis Streams는 append-only 로그 구조다. 메시지가 시간 순서대로 쌓이며, 명시적으로 삭제하지 않는 한 영구 보관된다.

```
Stream "orders"
┌─────────────────────────────────────┐
│ 1737284567890-0 | order:123, $100  │
│ 1737284567891-0 | order:456, $200  │
│ 1737284567892-0 | order:789, $300  │
└─────────────────────────────────────┘
```

각 메시지는 고유한 ID를 가지며, 이 ID는 자동으로 생성되거나 명시적으로 지정할 수 있다.

### XADD: 메시지 추가

```bash
XADD orders * orderId 123 amount 10000 status pending
# → "1737284567890-0"
```

- `orders`: Stream 이름 (없으면 자동 생성)
- `*`: ID 자동 생성 (`*` 대신 특정 ID도 가능)
- `orderId 123 amount 10000`: 필드-값 쌍 (여러 개 가능)

**메시지 ID 구조**:
```
1737284567890-0
└─────┬──────┘ │
   timestamp   sequence
```
- 앞부분: 밀리초 단위 Unix timestamp
- 뒷부분: 같은 시간 내 순번 (동시에 여러 메시지가 추가될 경우)

### XRANGE: 메시지 조회

```bash
# 전체 조회
XRANGE orders - +

# 결과
1) 1) "1737284567890-0"
   2) 1) "orderId"
      2) "123"
      3) "amount"
      4) "10000"
      5) "status"
      6) "pending"
```

- `-`: 가장 작은 ID (처음)
- `+`: 가장 큰 ID (끝)

**특정 ID 이후만 조회**:
```bash
XRANGE orders 1737284567890-0 +
# → orderId:456, 789만 반환
```

**개수 제한**:
```bash
XRANGE orders - + COUNT 2
# → 처음 2개만
```

### XREAD: 실시간 읽기

```bash
# 처음부터 읽기
XREAD STREAMS orders 0

# 지금부터 새로운 것만 (BLOCK 5초)
XREAD BLOCK 5000 STREAMS orders $
```

**시작 위치**:
- `0`: 처음부터 모든 메시지
- `$`: 지금부터 새로운 것만
- `<특정 ID>`: 해당 ID 다음부터

**여러 Stream 동시 읽기**:
```bash
XREAD STREAMS orders payments notifications 0 0 0
# → 3개 Stream의 메시지 모두 반환
```

### XRANGE vs XREAD

- **XRANGE**: 과거 메시지 조회 (히스토리)
  - 특정 범위 지정 가능
  - 동기 방식

- **XREAD**: 실시간 메시지 대기 (polling)
  - BLOCK 옵션으로 대기 가능
  - 여러 Stream 동시 감시

### 1.2 Stream 정보 조회

```bash
# Stream 길이
XLEN orders
# → 3

# Stream 상세 정보
XINFO STREAM orders
```

`XINFO STREAM`은 다음 정보를 제공:
- length: 메시지 개수
- first-entry: 첫 메시지
- last-entry: 마지막 메시지
- groups: Consumer Group 개수

---

## Level 2: Consumer Groups

### Consumer Group이란?

Consumer Group은 여러 Consumer가 메시지를 나눠서 처리하도록 하는 메커니즘이다. 같은 그룹 내에서는 한 메시지가 한 Consumer에게만 전달된다.

```
Stream: [msg1][msg2][msg3]
         ↓
Consumer Group: email-workers
         ↓
    ┌────┼────┐
    ↓    ↓    ↓
  w1   w2   w3
 msg1 msg2 msg3
```

### XGROUP CREATE: Consumer Group 생성

```bash
XGROUP CREATE orders email-workers 0
```

- `orders`: Stream 이름
- `email-workers`: 그룹 이름
- `0`: 시작 위치 (0=처음부터, $=지금부터)

**그룹 정보 조회**:
```bash
XINFO GROUPS orders

# 결과
1) "name": "email-workers"
   "consumers": 0
   "pending": 0
   "last-delivered-id": "0-0"
```

### XREADGROUP: 그룹으로 메시지 읽기

```bash
XREADGROUP GROUP email-workers worker-1 COUNT 1 STREAMS orders >
```

- `email-workers`: 그룹 이름
- `worker-1`: Consumer 이름
- `COUNT 1`: 1개만 가져오기
- `>`: 아직 전달 안 된 메시지

**다른 Consumer가 읽기**:
```bash
XREADGROUP GROUP email-workers worker-2 COUNT 1 STREAMS orders >
# → 다른 메시지를 받음 (중복 없음)
```

### COUNT의 중요성

**COUNT 없이 읽으면**:
```bash
XREADGROUP GROUP workers worker-1 STREAMS orders >
# → 5개 전부 가져감

XREADGROUP GROUP workers worker-2 STREAMS orders >
# → 받을 게 없음
```

**COUNT를 사용하면**:
```bash
XREADGROUP GROUP workers worker-1 COUNT 1 STREAMS orders >
# → msg1

XREADGROUP GROUP workers worker-2 COUNT 1 STREAMS orders >
# → msg2

XREADGROUP GROUP workers worker-3 COUNT 1 STREAMS orders >
# → msg3
```

COUNT를 사용하면 메시지가 공평하게 분산된다.

### 같은 그룹 vs 다른 그룹

**Q: 같은 그룹의 Consumer들끼리는 받는게 안되고 다른 그룹이라면 하나의 메시지를 여러개로 가져갈 수 있나?**

A: 맞다. 각 그룹은 독립적으로 메시지를 읽는다:

```bash
# 그룹 A
XGROUP CREATE orders group-a 0
XREADGROUP GROUP group-a c1 STREAMS orders >
# → msg1, 2, 3 받음

# 그룹 B
XGROUP CREATE orders group-b 0
XREADGROUP GROUP group-b c1 STREAMS orders >
# → msg1, 2, 3 다시 받음 (독립적)
```

### ACK (처리 완료)

```bash
XACK orders workers <message-id>
```

ACK를 하지 않으면 메시지가 "Pending" 상태로 남는다.

### Pending 조회

**간단 조회**:
```bash
XPENDING orders workers

# 결과
1) (integer) 3          # 3개 Pending
2) "1737...-0"          # 첫 Pending ID
3) "1737...-2"          # 마지막 Pending ID
4) 1) "worker-1": "1"   # worker-1이 1개
   2) "worker-2": "1"
   3) "worker-3": "1"
```

**상세 조회**:
```bash
XPENDING orders workers - + 10

# 결과
1) 1) "1737...-0"        # 메시지 ID
   2) "worker-1"         # 누가 받았는지
   3) (integer) 15000    # 15초 전에 받음
   4) (integer) 1        # 전달 횟수
```

### ">" vs "0"

- `>`: 아직 전달 안 된 새 메시지
- `0`: 이미 받았지만 ACK 안 한 Pending 메시지

**Pending 메시지 재처리**:
```bash
# Pending 메시지 다시 읽기
XREADGROUP GROUP workers worker-1 STREAMS orders 0
# → ACK 안 한 메시지 반환
```

### XCLAIM: Pending 메시지 재할당

다른 Consumer에게 Pending 메시지를 넘길 수 있다:

```bash
XCLAIM orders workers worker-2 10000 <msg-id>
```

- `worker-2`: 새 주인
- `10000`: 10초 이상 Pending된 것만

### Consumer 정보 조회

```bash
XINFO CONSUMERS orders workers

# 결과
1) "name": "worker-1"
   "pending": 2
   "idle": 15000    # 15초 전에 마지막으로 읽음
```

---

## Level 3: Offset과 메시지 진행 상태

### Offset이란?

Consumer Group에서 "어디까지 읽었는지"를 기록하는 개념이다. Redis Streams에서는 이를 `last-delivered-id`라는 필드로 관리한다.

**테스트**:
```bash
DEL mybook
XADD mybook * chapter 1 title "시작"
XADD mybook * chapter 2 title "모험"
XADD mybook * chapter 3 title "위기"
XADD mybook * chapter 4 title "극복"
XADD mybook * chapter 5 title "결말"

XGROUP CREATE mybook readers 0
```

**초기 상태**:
```bash
XINFO GROUPS mybook

# 결과
"last-delivered-id": "0-0"  # 아직 아무 메시지도 전달 안 함
```

**reader-1이 1개 읽기**:
```bash
XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 1

XINFO GROUPS mybook
# 결과
"last-delivered-id": "1737...-0"  # chapter 1 ID
```

**한 번 더 읽기**:
```bash
XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 2

# Offset이 chapter 2 ID로 업데이트됨
```

### ">"의 정확한 의미

`>`는 "last-delivered-id 다음부터"를 의미한다:

```
Stream: [ch1][ch2][ch3][ch4][ch5]
              ↑
       last-delivered-id = ch2

다음 ">" 요청 시: ch3부터 전달
```

**확인**:
```bash
# 현재 Offset = chapter 2

XREADGROUP GROUP readers reader-1 COUNT 1 STREAMS mybook >
# → chapter 3 받음 (chapter 1, 2가 아님)
```

### Offset vs Pending

**테스트**:
```bash
DEL mybook
XADD mybook * chapter 1
XADD mybook * chapter 2
XADD mybook * chapter 3
XGROUP CREATE mybook readers 0

# 3개 모두 읽기 (ACK 안 함)
XREADGROUP GROUP readers reader-1 STREAMS mybook >
```

**상태 확인**:
```bash
XINFO GROUPS mybook

# 결과
"last-delivered-id": "1737...-2"  # chapter 3 ID
"pending": 3
```

- Offset: chapter 3까지 전달했다
- Pending: 3개가 ACK 대기 중이다

**chapter 1만 ACK**:
```bash
XACK mybook readers <chapter-1-id>

XINFO GROUPS mybook
# 결과
"last-delivered-id": "1737...-2"  # 변화 없음
"pending": 2  # 줄어듦
```

**결론**: ACK는 Pending에만 영향을 준다. Offset은 변하지 않는다.

### Q: ACK를 해도 Redis에는 남아있나?

A: 맞다. ACK를 해도 메시지는 Stream에 그대로 남는다.

```bash
DEL orders
XADD orders * orderId 123
XADD orders * orderId 456
XADD orders * orderId 789

XGROUP CREATE orders workers 0

# 메시지 읽고 ACK
XREADGROUP GROUP workers worker-1 COUNT 1 STREAMS orders >
XACK orders workers <msg-id>
```

**Pending 확인**:
```bash
XPENDING orders workers
# → 0개
```

**Stream 확인**:
```bash
XRANGE orders - +
# → orderId:123, 456, 789 모두 존재
```

ACK는 Pending 목록에서만 제거한다. 메시지 자체는 삭제되지 않는다.

**다른 그룹이 읽을 수 있다**:
```bash
XGROUP CREATE orders analytics 0
XREADGROUP GROUP analytics a1 COUNT 1 STREAMS orders >
# → orderId:123 (workers 그룹이 ACK한 메시지)
```

### ReadOffset의 종류

Spring Data Redis에서 사용하는 ReadOffset:

**1. lastConsumed() → ">"**
```bash
XREADGROUP ... STREAMS mystream >
```
Offset 다음부터 읽는다. 가장 일반적이다.

**2. latest() → "$"**
```bash
XREADGROUP ... STREAMS mystream $
```
지금부터 새로 들어오는 것만. 과거는 무시.

**테스트**:
```bash
DEL test
XADD test * msg 1
XADD test * msg 2
XADD test * msg 3

XGROUP CREATE test group1 0

XREADGROUP GROUP group1 c1 STREAMS test $
# → 비어있음 (기존 메시지 무시)

# 새 메시지 추가
XADD test * msg 4

XREADGROUP GROUP group1 c1 STREAMS test $
# → msg 4만 받음
```

실시간 알림 같은 경우 유용하다.

**3. from(messageId)**
```bash
XREADGROUP ... STREAMS mystream <specific-id>
```
특정 ID 이후부터. 재처리할 때 사용.

### Offset 재설정

```bash
DEL mybook
XADD mybook * chapter 1
XADD mybook * chapter 2
XADD mybook * chapter 3
XADD mybook * chapter 4
XADD mybook * chapter 5

XGROUP CREATE mybook readers 0

# chapter 3까지 읽음
XREADGROUP GROUP readers r1 COUNT 3 STREAMS mybook >

# chapter 1 ID 확인
XRANGE mybook - + COUNT 1
# → "1737...-0"

# Offset 재설정
XGROUP SETID mybook readers 1737...-0

# 다시 읽기
XREADGROUP GROUP readers r1 COUNT 1 STREAMS mybook >
# → chapter 2 (chapter 1 다음부터)
```

### Consumer별로는 Offset이 없다

중요: Offset은 Consumer 개별이 아니라 Consumer Group 전체가 공유한다.

```bash
DEL test
XADD test * msg 1
XADD test * msg 2
XADD test * msg 3
XADD test * msg 4

XGROUP CREATE test workers 0

# worker-1이 2개 읽기
XREADGROUP GROUP workers worker-1 COUNT 2 STREAMS test >
# → msg 1, 2

# Offset 확인
XINFO GROUPS test
# 결과: "last-delivered-id": "...-1"  # msg 2 ID

# worker-2가 읽기
XREADGROUP GROUP workers worker-2 COUNT 1 STREAMS test >
# → msg 3 (msg 1, 2가 아님!)
```

worker-2는 msg 1, 2를 받지 않았지만, 그룹의 Offset이 msg 2까지 진행되어 있어서 msg 3을 받는다.

**정리**:
- Offset: 그룹 단위
- Pending: Consumer 단위

---

## Level 4: Spring Data Redis Abstractions

### StreamMessageListenerContainer

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

`pollTimeout`을 1초로 설정하면 1초마다 Redis에 새 메시지를 확인한다.

**내부 동작**:
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

### Consumer.from()

```kotlin
Consumer.from("notification-service", "server-1")
```

이것은 다음 Redis 명령어로 변환:
```bash
XREADGROUP GROUP notification-service server-1 ...
```

**멀티 인스턴스 환경**에서 각 서버를 구분하기 위해 Consumer 이름을 자동 생성:
```kotlin
val consumerName = "${InetAddress.getLocalHost().hostName}-${System.currentTimeMillis()}"
Consumer.from("notification-service", consumerName)
// → Consumer.from("notification-service", "MacBook-1737284567890")
```

### StreamOffset.create()

```kotlin
StreamOffset.create("order-events", ReadOffset.lastConsumed())
```

이것은 다음 Redis 명령어로 변환:
```bash
STREAMS order-events >
```

**ReadOffset 종류**:

1. **lastConsumed() → ">"**
```kotlin
StreamOffset.create("orders", ReadOffset.lastConsumed())
// STREAMS orders >
```

2. **latest() → "$"**
```kotlin
StreamOffset.create("notifications", ReadOffset.latest())
// STREAMS notifications $
```

3. **from(messageId)**
```kotlin
StreamOffset.create("orders", ReadOffset.from("1737284567890-0"))
// STREAMS orders 1737284567890-0
```

### MapRecord

메시지는 `MapRecord<String, String, String>` 타입으로 전달:

```kotlin
record.stream      // "order-events"
record.id          // RecordId("1737284567890-0")
record.value       // Map<String, String>
```

Redis에 저장된 형태:
```bash
XADD order-events * payload '{"@class":"OrderCreatedEvent","orderId":"123"}'
```

`record.value`로 전달:
```kotlin
Map("payload" -> '{"@class":"OrderCreatedEvent","orderId":"123"}')
```

"payload" 키에서 JSON을 추출해서 역직렬화한다.

### receiveAutoAck()

메시지를 읽고 콜백을 실행한 후 자동으로 ACK를 보낸다:

```kotlin
container.receiveAutoAck(
  Consumer.from("notification-service", "server-1"),
  StreamOffset.create("order-events", ReadOffset.lastConsumed())
) { record ->
  handleMessage(record)
}
```

**내부 동작**:
```
1. XREADGROUP GROUP notification-service server-1
   COUNT 10 BLOCK 1000 STREAMS order-events >
2. 메시지 받음
3. 콜백 실행: handleMessage(record)
4. 성공 시: XACK order-events notification-service <msg-id>
5. 실패 시: ACK 안 함 (Pending 유지)
```

실패 시 ACK를 보내지 않으므로 Pending 상태로 남는다. 이후 `XREADGROUP ... 0`으로 재처리할 수 있다.

### 전체 흐름 매핑

```kotlin
container.receiveAutoAck(
  Consumer.from("notification-service", "MacBook-123"),
  StreamOffset.create("order-events", ReadOffset.lastConsumed())
) { record ->
  processMessage(record)
}
```

이것은 다음으로 변환:
```bash
# 1초마다 실행 (pollTimeout)
XREADGROUP GROUP notification-service MacBook-123
  COUNT 10
  BLOCK 1000
  STREAMS order-events >

# 성공 시
XACK order-events notification-service <msg-id>
```

### 멀티 인스턴스 환경

3대 서버에서 동일한 코드 실행:

```kotlin
@ValkeyListener(
  stream = "order-events",
  consumerGroup = "notification-service"
)
fun sendEmail(event: OrderCreatedEvent) { }
```

각 서버:
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

### receiveAutoAck vs receive

`receive()`를 사용하면 수동으로 ACK를 제어:

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

`receiveAutoAck()`는 간단하지만 세밀한 제어가 어렵다. 조건부 ACK가 필요한 경우 `receive()`를 사용.

---

## Level 5: ValkeyListenerRegistrar 구현

### SmartInitializingSingleton

`ValkeyListenerRegistrar`는 `SmartInitializingSingleton` 인터페이스를 구현:

```kotlin
@Component
class ValkeyListenerRegistrar(
  private val applicationContext: ApplicationContext,
  private val connectionFactory: RedisConnectionFactory,
  private val redisTemplate: RedisTemplate<String, RedisStorable>,
) : SmartInitializingSingleton
```

모든 빈이 초기화된 후 `afterSingletonsInstantiated()` 메서드를 호출:

```
Spring 시작 과정:
1. 빈 정의 읽기
2. 빈 생성
3. 의존성 주입
4. @PostConstruct 실행
5. SmartInitializingSingleton.afterSingletonsInstantiated() 실행
```

모든 빈이 준비된 시점에서 `@ValkeyListener`를 스캔하기 위한 구조.

### Container 생성 및 시작

`afterSingletonsInstantiated()` 첫 부분에서 Container 생성:

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

`pollTimeout`을 1초로 설정. 백그라운드 스레드가 1초마다 Redis에 새 메시지를 확인.

### 빈 스캔

모든 빈을 순회하며 `@ValkeyListener`가 붙은 메서드를 찾음:

```kotlin
applicationContext.beanDefinitionNames.forEach { beanName ->
  val bean = applicationContext.getBean(beanName)

  bean::class.java.methods.forEach { method ->
    val ann = method.getAnnotation(ValkeyListener::class.java) ?: return@forEach

    // Listener 등록 로직
  }
}
```

일부 빈은 `getBean()` 실패할 수 있어서 예외를 무시하도록 처리.

### 메서드 시그니처 검증

Listener 메서드는 파라미터가 정확히 1개:

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

반환 타입은 `Unit`이 권장되지만, 경고만 출력하고 진행.

파라미터 타입이 `RedisStorable`을 구현하는지 확인:

```kotlin
val paramType = method.parameterTypes.first()
val kotlinClass = paramType.kotlin

if (!kotlinClass.isSubclassOf(RedisStorable::class)) {
  throw InvalidValkeyListenerException(
    "Parameter type ${paramType.name} must implement RedisStorable"
  )
}
```

### Consumer Group 생성

Stream 이름 검증 후 Consumer Group 생성:

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

이미 존재하면 예외 발생하지만 무시. 재시작 시에도 문제없이 동작.

### Consumer 이름 생성

Consumer 이름이 비어있으면 자동 생성:

```kotlin
val consumerName =
  ann.consumerName.ifBlank {
    "${InetAddress.getLocalHost().hostName}-${System.currentTimeMillis()}"
  }
```

예시: `"MacBook-Pro.local-1737284567890"`

멀티 인스턴스 환경에서 각 서버를 구분할 수 있다.

### Listener 등록

Container에 Listener 등록:

```kotlin
container.receiveAutoAck(
  Consumer.from(ann.consumerGroup, consumerName),
  StreamOffset.create(ann.stream, ReadOffset.lastConsumed()),
) { record ->
  handleStreamMessage(bean, method, record, paramType)
}
```

이것은 다음 Redis 명령어로 변환:

```bash
XREADGROUP GROUP notification-service MacBook-1737284567890
  COUNT 10
  BLOCK 1000
  STREAMS order-events >
```

### 메시지 처리

`handleStreamMessage()`에서 실제 메시지 처리:

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

**payload 필드**:
메시지는 다음 형식으로 저장:
```bash
XADD order-events * payload '{"@class":"OrderCreatedEvent",...}'
```

`record.value`는 `Map("payload" -> "{...}")`이므로, "payload" 키에서 JSON을 추출.

**valueSerializer 재사용**:
`ValkeyConfig`에서 설정한 `Jackson2JsonRedisSerializer`를 재사용. `@class` 정보가 포함되어 있어서 타입을 복원할 수 있다:

```json
{
  "@class": "com.example.OrderCreatedEvent",
  "orderId": "123"
}
```

**리플렉션 호출**:
`method.invoke(bean, deserializedMessage)`로 실제 Listener 메서드를 호출:

```kotlin
// 이것이 실행됨
orderEventListener.sendEmail(OrderCreatedEvent(orderId = "123"))
```

**예외 처리**:
예외가 발생하면 `ValkeyMessageProcessingException`을 던짐. `receiveAutoAck`는 이 예외를 catch하고 ACK를 보내지 않음. 메시지가 Pending 상태로 남아서 나중에 재처리할 수 있음.

### 전체 흐름

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

### 핵심 역할

`ValkeyListenerRegistrar`는:

- `@ValkeyListener` 어노테이션 스캔
- Consumer Group 자동 생성
- 메서드 시그니처 검증
- Container 기반 백그라운드 polling
- 메시지 역직렬화 및 메서드 호출
- 자동 ACK 처리

Spring의 이벤트 리스너와 유사하지만, Redis Streams의 Consumer Group 개념을 통합. 멀티 인스턴스 환경에서 중복 처리 없이 메시지를 분산할 수 있다.

예외 발생 시 ACK를 보내지 않아서 Pending 상태로 남음. 재처리 메커니즘을 별도로 구현할 수 있는 여지.
