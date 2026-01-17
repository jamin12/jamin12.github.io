---
layout: post
title: "Gradle로 Pact 테스트 순서 조절하기"
date: 2026-01-13
categories: [기타, 러너스하이2, 주제1]
tags: [cdc, 러너스하이2_주제1, gradle]
---

## 왜 순서가 중요한가

Pact의 동작 흐름은 명확하다.

1. Consumer가 테스트를 실행하면서 Pact 파일을 생성한다
2. 생성된 Pact 파일을 Pact Broker에 발행한다
3. Provider가 Broker에서 Pact 파일을 가져와서 자신의 API가 계약을 만족하는지 검증한다

이 흐름에서 순서가 틀어지면 문제가 생긴다.

- Provider 테스트가 먼저 실행되면, Broker에 최신 Pact 파일이 없어서 검증할 수 없다
- Consumer 테스트가 실행되었지만 발행이 안 되면, Provider는 이전 계약으로 검증한다

결국 **Consumer Test → Pact Publish → Provider Test** 순서를 Gradle Task 레벨에서 강제해야 했다.

## 첫 번째 시도: 그냥 태스크 두 개 만들기

처음에는 단순하게 생각했다.

```kotlin
tasks.register<Test>("pactConsumerTest") {
  description = "Runs Pact Consumer tests only."
  useJUnitPlatform {
    includeTags("pact-consumer")
  }
}

tasks.register<Test>("pactProviderTest") {
  description = "Runs Pact Provider tests only."
  useJUnitPlatform {
    includeTags("pact-provider")
  }
}
```

이렇게 만들고 각각 실행하면 되지 않을까 싶었다.

문제는 이 방식은 **사람이 순서를 기억해야 한다**는 점이었다. Gradle Task는 기본적으로 독립적으로 실행되기 때문에, 누군가 `./gradlew pactProviderTest`를 먼저 실행하면 Consumer의 Pact 파일이 없는 상태로 검증이 돌아간다.

이건 내가 피하고 싶었던 "사람의 기억에 의존하는 구조"와 다를 게 없었다.

## 두 번째 시도: dependsOn으로 의존성 추가

Gradle에는 Task 의존성을 걸 수 있는 `dependsOn`이 있다는 걸 알게 됐다.

```kotlin
tasks.register("pactTest") {
  dependsOn("pactConsumerTest")
  dependsOn("pactProviderTest")
}
```

이렇게 하면 `pactTest`를 실행했을 때 Consumer와 Provider가 둘 다 실행된다.

그런데 이것만으로는 **순서가 보장되지 않았다**. `dependsOn`은 "이 태스크들이 실행되어야 한다"는 의미일 뿐, 실행 순서까지 정하지는 않는다. Gradle은 병렬 실행 최적화를 위해 의존성이 없는 태스크들을 동시에 실행할 수 있다.

결과적으로 Consumer와 Provider가 거의 동시에 실행되는 상황이 발생했다.

## Gradle Task 순서 제어 방법 학습

Gradle 문서를 찾아보니 순서를 제어하는 방법이 몇 가지 있었다.

### 1. shouldRunAfter (권장)

```kotlin
taskB.shouldRunAfter(taskA)
```

- "가능하면 A 이후에 B를 실행해라"라는 의미
- 강제성은 약하지만, 대부분의 상황에서 순서를 보장한다
- 순환 의존성이 생기면 무시된다

### 2. mustRunAfter (강제)

```kotlin
taskB.mustRunAfter(taskA)
```

- "반드시 A 이후에 B를 실행해라"
- 더 강한 순서 보장
- 순환 의존성이 생기면 빌드 실패

### 3. finalizedBy (후속 작업)

```kotlin
taskA.finalizedBy(taskB)
```

- "A가 끝나면 반드시 B를 실행해라"
- A가 실패해도 B는 실행된다 (cleanup 작업에 유용)

## 최종 해결 방법

이 개념들을 조합해서 최종 구조를 만들었다.

```kotlin
// 1. Consumer 테스트 정의
tasks.register<Test>("pactConsumerTest") {
  description = "Runs Pact Consumer tests only."
  group = "verification"
  testClassesDirs = sourceSets["test"].output.classesDirs
  classpath = sourceSets["test"].runtimeClasspath
  useJUnitPlatform {
    includeTags("pact-consumer")
  }
  // Consumer 테스트가 끝나면 반드시 Pact 파일을 발행한다
  finalizedBy(pactPublishTasks)
}

// 2. Provider 테스트 정의
tasks.register<Test>("pactProviderTest") {
  description = "Runs Pact Provider tests only."
  group = "verification"
  testClassesDirs = sourceSets["test"].output.classesDirs
  classpath = sourceSets["test"].runtimeClasspath
  useJUnitPlatform {
    includeTags("pact-provider")
  }
  // Consumer 테스트 이후에 실행되어야 한다
  shouldRunAfter(tasks.named("pactConsumerTest"))

  // Provider가 Broker에서 Pact 파일을 가져올 수 있도록 연결 정보 주입
  systemProperty("pactbroker.url", brokerUrl)
  systemProperty("pactbroker.host", brokerHost)
  systemProperty("pactbroker.auth.username", brokerUsername)
  systemProperty("pactbroker.auth.password", brokerPassword)
}

// 3. 통합 태스크
tasks.register("pactTest") {
  description = "Runs Pact Consumer then Provider tests."
  group = "verification"

  // Consumer와 Provider 둘 다 실행되어야 한다
  dependsOn("pactConsumerTest")
  dependsOn("pactProviderTest")

  // Provider는 반드시 Consumer 이후에 실행되어야 한다
  tasks.findByName("pactProviderTest")?.mustRunAfter("pactConsumerTest")
}
```

### 핵심 포인트

1. **`finalizedBy(pactPublishTasks)`**
   - Consumer 테스트가 끝나면 자동으로 Pact 파일을 Broker에 발행
   - 테스트 성공/실패 여부와 무관하게 발행 시도 (최신 상태 유지)

2. **`shouldRunAfter`와 `mustRunAfter` 조합**
   - Provider 테스트 자체에는 `shouldRunAfter` 적용 (독립 실행 시 유연성 유지)
   - 통합 태스크(`pactTest`)에서는 `mustRunAfter`로 순서 강제

3. **System Property 주입**
   - Provider 테스트가 실행될 때 Broker 연결 정보를 런타임에 전달
   - 테스트 코드는 환경에 무관하게 작성 가능

## 검증

이제 다음과 같은 실행 흐름이 보장된다.

```bash
# 통합 테스트 실행
./gradlew pactTest
```

**실행 순서:**
1. `pactConsumerTest` 실행 → Pact 파일 생성 (`build/pacts/`)
2. `pactPublish` 자동 실행 → Broker에 Pact 파일 업로드
3. `pactProviderTest` 실행 → Broker에서 Pact 파일 다운로드 → 검증

만약 Provider 검증이 실패하면, 빌드 전체가 실패한다. 이 시점에서 "서버 A의 변경이 서버 B를 깨뜨린다"는 사실이 **배포 전에** 드러난다.

---

## 태그 기반 테스트 분리 전략

Gradle Task에서 `includeTags`와 `excludeTags`를 사용하려면, 테스트 클래스에 `@Tag` 어노테이션이 달려 있어야 한다.

문제는 Pact 테스트를 작성할 때마다 매번 `@Tag("pact-consumer")`나 `@Tag("pact-provider")`를 붙이는 건 번거롭고, 실수로 빼먹을 가능성이 있다는 점이었다.

### Abstract 클래스로 태그 자동 적용

이 문제를 해결하기 위해 공통 abstract 클래스를 만들고, 거기에 태그를 달아뒀다.

**PactConsumerTestBase.kt**
```kotlin
package com.nhn.inje.ccp.pact

import au.com.dius.pact.consumer.junit5.PactConsumerTest
import org.junit.jupiter.api.Tag

/**
 * Pact Consumer 테스트 베이스 클래스
 *
 * 이 클래스를 상속하면 자동으로 @Tag("pact-consumer")가 적용됩니다.
 * pactConsumerTest Gradle 태스크에서 실행됩니다.
 */
@PactConsumerTest
@Tag("pact-consumer")
abstract class PactConsumerTestBase
```

**PactProviderTestBase.kt**
```kotlin
package com.nhn.inje.ccp.pact

import org.junit.jupiter.api.Tag

/**
 * Pact Provider 테스트 베이스 클래스
 *
 * 이 클래스를 상속하면 자동으로 @Tag("pact-provider")가 적용됩니다.
 * pactProviderTest Gradle 태스크에서 실행됩니다.
 */
@Tag("pact-provider")
abstract class PactProviderTestBase
```

이 클래스들을 `core/common-pact` 모듈에 배치했다. Pact 테스트를 작성하는 모든 모듈에서 이 클래스를 의존성으로 가져와 사용할 수 있다.

### 실제 사용 예시

이제 Pact 테스트를 작성할 때는 다음과 같이 해당 Base 클래스를 상속받기만 하면 된다.

**Consumer 테스트 예시**
```kotlin
import com.nhn.inje.ccp.pact.PactConsumerTestBase
import au.com.dius.pact.consumer.dsl.PactDslWithProvider
import au.com.dius.pact.core.model.V4Pact

class ProjectApiConsumerTest : PactConsumerTestBase() {

  @Pact(provider = "project-api", consumer = "member-service")
  fun createPact(builder: PactDslWithProvider): V4Pact {
    return builder
      .given("프로젝트가 존재한다")
      .uponReceiving("프로젝트 조회 요청")
      .path("/api/v1/projects/123")
      .method("GET")
      .willRespondWith()
      .status(200)
      .body(...)
      .toPact(V4Pact::class.java)
  }

  @Test
  @PactTestFor(pactMethod = "createPact")
  fun testGetProject(mockServer: MockServer) {
    // 테스트 로직
  }
}
```

**Provider 테스트 예시**
```kotlin
import com.nhn.inje.ccp.pact.PactProviderTestBase
import au.com.dius.pact.provider.junit5.PactVerificationContext
import au.com.dius.pact.provider.junitsupport.Provider

@Provider("project-api")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ProjectApiProviderTest : PactProviderTestBase() {

  @TestTemplate
  @ExtendWith(PactVerificationInvocationContextProvider::class)
  fun pactVerificationTestTemplate(context: PactVerificationContext) {
    context.verifyInteraction()
  }

  @BeforeEach
  fun setup(context: PactVerificationContext) {
    context.target = SpringBootHttpTarget()
  }
}
```

### 장점

이 구조의 장점은 명확하다.

1. **일관성 보장**: 모든 Pact 테스트가 동일한 태그를 갖게 된다
2. **실수 방지**: 개발자가 태그를 붙이는 걸 깜빡할 가능성이 없다
3. **중앙 관리**: 태그 이름을 바꾸거나 추가 설정을 하려면 Base 클래스만 수정하면 된다
4. **명시적 의도**: "이 테스트는 Pact 테스트다"라는 의도가 클래스 선언부터 드러난다

이제 Pact 테스트를 작성하는 사람은 단순히 Base 클래스를 상속받기만 하면, Gradle Task에서 자동으로 인식되고 올바른 순서로 실행된다.

---

## 일반 테스트와의 분리

마지막으로 중요한 부분은, 일반 테스트(`./gradlew test`)에서는 Pact 테스트를 제외한다는 점이다.

```kotlin
tasks.named<Test>("test") {
  useJUnitPlatform {
    excludeTags("pact-consumer", "pact-provider")
  }
}
```

이렇게 하면:
- 일반 단위 테스트는 빠르게 실행 가능
- Pact 테스트는 명시적으로 `pactTest`를 실행할 때만 돌아감
- CI/CD 파이프라인에서 단계별로 제어 가능

## 남은 과제

현재 구조는 로컬 환경에서 순서를 보장하는 수준이다.

다음 단계는 이걸 CI/CD 파이프라인에 녹이는 것이다. Jenkins나 GitHub Actions에서 다음과 같은 단계를 구성해야 한다.

1. Consumer 모듈 빌드 시: `pactConsumerTest` 실행 → Pact 발행
2. Provider 모듈 빌드 시: `pactProviderTest` 실행 → 검증 실패 시 배포 차단
3. 각 서비스의 배포 파이프라인에 Pact 검증 단계 추가

이 부분은 다음 글에서 다룰 예정이다.
