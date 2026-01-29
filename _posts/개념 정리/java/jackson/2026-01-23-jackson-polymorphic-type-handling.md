---
layout: post
title: "Jackson의 다형성 타입 처리: @JsonTypeInfo와 activateDefaultTyping의 역할 분담"
date: 2026-01-23
categories: [개념정리, jackson]
tags: [jackson, serialization, redis]
---

Redis에 객체를 저장하고 조회하는 과정에서 `@JsonTypeInfo`와 `activateDefaultTyping()` 두 가지 설정을 함께 사용하고 있었다. 각각의 역할이 무엇인지, 왜 둘 다 필요한지 명확히 이해하지 못했다.

특히 Kotlin의 data class는 기본적으로 final인데, 어떻게 타입 정보(`@class`)가 추가되는지, 그리고 제네릭 타입에서는 어떻게 동작하는지 궁금했다. Jackson의 내부 동작 원리를 파악하고, 두 설정의 정확한 역할 분담을 정리했다.

## 1. 기본 설정 구조

### Redis 직렬화 설정

```kotlin
@JsonTypeInfo(
  use = JsonTypeInfo.Id.CLASS,
  include = JsonTypeInfo.As.PROPERTY,
  property = "@class",
)
interface RedisStorable

@Bean
fun redisStorableSerializer(): Jackson2JsonRedisSerializer<RedisStorable> {
  val objectMapper = valkeyObjectMapper.copy()
  objectMapper.activateDefaultTyping(
    objectMapper.polymorphicTypeValidator,
    ObjectMapper.DefaultTyping.NON_FINAL,
    JsonTypeInfo.As.PROPERTY,
  )
  return Jackson2JsonRedisSerializer(objectMapper, RedisStorable::class.java)
}
```

### 사용 예시

```kotlin
// RedisStorable 구현 클래스
data class UserInfo(
  val userId: String,
  val email: String,
) : RedisStorable

// 일반 POJO
data class Address(
  val city: String,
  val zipCode: String,
)

// 제네릭 래퍼
data class CachedDashboardData<T>(
  val data: T,
  val lastRefreshedAt: ZonedDateTime,
) : RedisStorable
```

### 핵심 의문

1. `@JsonTypeInfo`와 `NON_FINAL`의 차이는 무엇인가?
2. Kotlin data class는 final인데 왜 타입 정보가 추가되는가?
3. 제네릭 타입 내부의 객체는 어떻게 처리되는가?

## 2. NON_FINAL의 동작 원리

Jackson의 `activateDefaultTyping(NON_FINAL)`은 **필드의 선언된 타입(declared type)**을 기준으로 판단한다.

### 판단 기준

```kotlin
data class Container(
  val message: SimpleMessage,  // 선언 타입: SimpleMessage (final)
  val payload: Any,            // 선언 타입: Any (non-final)
  val data: T,                 // 선언 타입: T → Object (non-final)
  val items: List<String>,     // 선언 타입: List (interface, non-final)
)
```

| 필드 | 선언 타입 | final 여부 | NON_FINAL 적용 |
|-----|---------|----------|--------------|
| `message: SimpleMessage` | SimpleMessage | final | X |
| `payload: Any` | Any | non-final | O |
| `data: T` | T → Object | non-final | O |
| `items: List<String>` | List | interface | O |

### final 판단 기준

Jackson은 Java의 `Modifier.isFinal()`을 사용하여 클래스가 final인지 확인한다.

```kotlin
// Kotlin data class는 기본적으로 final
data class SimpleMessage(...)

// Java 바이트코드
public final class SimpleMessage { ... }
```

**중요**: Kotlin의 모든 data class는 final이므로, `NON_FINAL` 설정만으로는 타입 정보가 추가되지 않는다.

### 왜 제네릭에서는 타입 정보가 붙는가?

제네릭 타입 파라미터는 내부적으로 `Object`(Kotlin의 `Any`)로 취급되고, `Object`는 non-final이기 때문이다.

```kotlin
data class CachedDashboardData<T>(
  val data: T,  // T → Object로 취급 (non-final)
)
```

Jackson이 `data` 필드를 직렬화할 때:
1. 선언 타입 확인: `T` → `Object`
2. `Object`는 non-final
3. NON_FINAL 규칙 적용됨
4. 런타임 실제 타입 확인 → `@class` 추가

## 3. @JsonTypeInfo의 역할

`@JsonTypeInfo`는 인터페이스에 선언하면 구현체에 **상속**된다.

### 동작 원리

```kotlin
@JsonTypeInfo(...)
interface RedisStorable

data class SimpleMessage(...) : RedisStorable
// → SimpleMessage에 @JsonTypeInfo가 상속됨!
```

Jackson이 `SimpleMessage`를 직렬화할 때:
1. "이 클래스가 `@JsonTypeInfo`를 가진 인터페이스를 구현하나?" 확인
2. 구현한다면 → `@class` 필드 추가
3. **final 여부와 무관하게 동작**

이것이 바로 Kotlin의 final data class에도 타입 정보가 추가되는 이유다.

## 4. 두 설정의 역할 분담

### @JsonTypeInfo의 역할

**대상**: RedisStorable을 **직접 구현한 클래스**

```kotlin
data class SimpleMessage(...) : RedisStorable
data class UserInfo(...) : RedisStorable
data class ContactInfo(...) : RedisStorable
```

**특징**:
- final class여도 타입 정보 추가
- 상속을 통해 적용
- RedisStorable 구현체 자체의 타입 정보 보존

### activateDefaultTyping(NON_FINAL)의 역할

**대상**: **제네릭/Any/인터페이스 타입 필드** 내부의 객체

```kotlin
data class GenericMessage<T>(
  val data: T,  // T는 Object로 취급 (non-final)
)

data class AnyMessage(
  val payload: Any,  // Any는 non-final
)

data class MapMessage(
  val settings: Map<String, Any>,  // Map은 interface
)
```

**특징**:
- 선언 타입이 non-final인 필드에 적용
- 제네릭 타입 파라미터(`T`)는 `Object`로 취급되어 non-final
- 필드 내부의 실제 객체 타입 정보 보존

## 5. 실제 적용 사례

### SimpleMessage (최상위)

```kotlin
data class SimpleMessage(...) : RedisStorable
```

```json
{
  "@class": "SimpleMessage",  // @JsonTypeInfo가 처리
  "content": "..."
}
```

### CachedDashboardData (제네릭 래퍼)

```kotlin
data class CachedDashboardData<T>(
  val data: T,  // UserInfo가 들어감
) : RedisStorable
```

```json
{
  "@class": "CachedDashboardData",  // @JsonTypeInfo
  "data": {
    "@class": "UserInfo",  // NON_FINAL (T는 Object)
    "userId": "..."
  }
}
```

### ComplexMessage (혼합)

```kotlin
data class ComplexMessage(
  val contact: ContactInfo,     // 구체적 타입
  val settings: Map<String, Any>,  // Any 타입
) : RedisStorable
```

```json
{
  "@class": "ComplexMessage",  // @JsonTypeInfo
  "contact": {
    "@class": "ContactInfo",  // @JsonTypeInfo (ContactInfo도 RedisStorable)
    "email": "..."
  },
  "settings": {
    "@class": "java.util.LinkedHashMap",  // NON_FINAL (Map은 interface)
    "key1": {
      "@class": "SomeClass",  // NON_FINAL (Any 안의 객체)
      "value": "..."
    }
  }
}
```

## 6. 최적화: JAVA_LANG_OBJECT

`NON_FINAL` 대신 `JAVA_LANG_OBJECT`를 사용하면 불필요한 타입 정보를 줄일 수 있다.

### NON_FINAL의 문제점

모든 non-final 타입(인터페이스, 추상 클래스, open class)에 타입 정보를 추가한다. 이는 RedisStorable을 구현한 클래스에 중복으로 타입 정보를 추가하는 결과를 낳는다.

```json
{
  "contact": {
    "@class": "ContactInfo",  // @JsonTypeInfo로 이미 처리되는데 중복!
    "email": "..."
  }
}
```

### JAVA_LANG_OBJECT 사용

```kotlin
objectMapper.activateDefaultTyping(
  objectMapper.polymorphicTypeValidator,
  ObjectMapper.DefaultTyping.JAVA_LANG_OBJECT,  // Object/Any 타입만
  JsonTypeInfo.As.PROPERTY,
)
```

**적용 대상**:
- `val data: Any`
- `val items: List<Any>`
- 제네릭 타입 파라미터 `T` (Object로 취급)
- 구체적인 타입 필드는 제외됨 (타입 정보 불필요)

**효과**: 중복 타입 정보 제거로 JSON 크기 감소

## 7. 결론

### 핵심 정리

1. **@JsonTypeInfo**: RedisStorable 구현체 자체에 타입 정보 추가
   - final data class에도 작동
   - 상속을 통해 적용
   - 최상위 객체 및 중첩 RedisStorable 객체 처리

2. **activateDefaultTyping**: 제네릭/Any 타입 필드 내부 객체에 타입 정보 추가
   - 선언 타입이 non-final인 경우에만 작동
   - 제네릭 `T`는 `Object`로 취급되어 non-final
   - 제네릭 래퍼 패턴에서 필수

3. **둘 다 필요한 이유**:
   - `@JsonTypeInfo` 없으면: 구체적인 RedisStorable 타입 정보 손실
   - `activateDefaultTyping` 없으면: 제네릭 필드 내부의 타입 정보 손실

### 최종 권장 설정

| 설정 | 대상 | 목적 |
|------|------|------|
| **@JsonTypeInfo** on RedisStorable | final data class | RedisStorable 타입들의 타입 정보 |
| **JAVA_LANG_OBJECT** | 제네릭/Any 필드 | 제네릭 래퍼 안의 타입 정보 |

```kotlin
@JsonTypeInfo(
  use = JsonTypeInfo.Id.CLASS,
  include = JsonTypeInfo.As.PROPERTY,
  property = "@class",
)
interface RedisStorable

@Bean
fun redisStorableSerializer(): Jackson2JsonRedisSerializer<RedisStorable> {
  val objectMapper = valkeyObjectMapper.copy()
  objectMapper.activateDefaultTyping(
    objectMapper.polymorphicTypeValidator,
    ObjectMapper.DefaultTyping.JAVA_LANG_OBJECT,  // NON_FINAL → JAVA_LANG_OBJECT
    JsonTypeInfo.As.PROPERTY,
  )
  return Jackson2JsonRedisSerializer(objectMapper, RedisStorable::class.java)
}
```
