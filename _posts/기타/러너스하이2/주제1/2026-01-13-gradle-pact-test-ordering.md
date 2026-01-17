---
layout: post
title: "Gradle로 Pact 테스트 순서 조절하기"
date: 2026-01-13
categories: [기타, 러너스하이2, 주제1]
tags: [cdc, 러너스하이2_주제1, gradle]
---

## 순서가 틀어지면 생기는 문제

Pact는 Consumer가 테스트를 실행해서 Pact 파일을 생성하고, 이를 Broker에 발행한 뒤, Provider가 Broker에서 가져와 검증하는 흐름으로 동작한다.

문제는 이 순서가 지켜지지 않으면 검증 자체가 의미가 없어진다는 점이었다.

- Provider 테스트가 먼저 실행되면 Broker에 최신 Pact 파일이 없어서 검증할 수 없다
- Consumer 테스트가 실행되었지만 발행이 안 되면 Provider는 이전 계약으로 검증한다

결국 **Consumer Test → Pact Publish → Provider Test** 순서를 Gradle Task 레벨에서 강제해야 했다.

## 태스크 두 개 만들기

처음에는 단순하게 접근했다.

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

각각 실행하면 되지 않을까 싶었는데, 이 방식은 사람이 순서를 기억해야 한다는 문제가 있었다. 누군가 `./gradlew pactProviderTest`를 먼저 실행하면 Consumer의 Pact 파일이 없는 상태로 검증이 돌아간다. 피하고 싶었던 구조였다.

## dependsOn으로 의존성 추가

Gradle에 Task 의존성을 거는 `dependsOn`이 있다는 걸 알게 됐다.

```kotlin
tasks.register("pactTest") {
  dependsOn("pactConsumerTest")
  dependsOn("pactProviderTest")
}
```

`pactTest`를 실행하면 Consumer와 Provider가 둘 다 실행된다.

그런데 이것만으로는 순서가 보장되지 않았다. `dependsOn`은 "이 태스크들이 실행되어야 한다"는 의미일 뿐, 실행 순서까지 정하지는 않는다. Gradle은 병렬 실행 최적화를 위해 의존성이 없는 태스크들을 동시에 실행할 수 있다.

결과적으로 Consumer와 Provider가 거의 동시에 실행되는 상황이 발생했다.

## Gradle Task 순서 제어 방법

Gradle 문서를 찾아보니 순서를 제어하는 방법이 몇 가지 있었다.

`shouldRunAfter`는 "가능하면 A 이후에 B를 실행해라"라는 의미다. 강제성은 약하지만 대부분의 상황에서 순서를 보장한다. 순환 의존성이 생기면 무시된다.

```kotlin
taskB.shouldRunAfter(taskA)
```

`mustRunAfter`는 "반드시 A 이후에 B를 실행해라"라는 의미로, 더 강한 순서 보장이 된다. 순환 의존성이 생기면 빌드가 실패한다.

```kotlin
taskB.mustRunAfter(taskA)
```

`finalizedBy`는 "A가 끝나면 반드시 B를 실행해라"라는 의미다. A가 실패해도 B는 실행되기 때문에 cleanup 작업에 유용하다.

```kotlin
taskA.finalizedBy(taskB)
```

## 최종 구성

이 개념들을 조합해서 다음과 같은 구조를 만들었다.

```kotlin
// Consumer 테스트
tasks.register<Test>("pactConsumerTest") {
  description = "Runs Pact Consumer tests only."
  group = "verification"
  testClassesDirs = sourceSets["test"].output.classesDirs
  classpath = sourceSets["test"].runtimeClasspath
  useJUnitPlatform {
    includeTags("pact-consumer")
  }
  // Consumer 테스트가 끝나면 Pact 파일을 발행한다
  finalizedBy(pactPublishTasks)
}

// Provider 테스트
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

// 통합 태스크
tasks.register("pactTest") {
  description = "Runs Pact Consumer then Provider tests."
  group = "verification"

  dependsOn("pactConsumerTest")
  dependsOn("pactProviderTest")

  // Provider는 반드시 Consumer 이후에 실행되어야 한다
  tasks.findByName("pactProviderTest")?.mustRunAfter("pactConsumerTest")
}
```

## 실행 흐름

`./gradlew pactTest`를 실행하면 다음 순서로 동작한다.

1. `pactConsumerTest` 실행 → Pact 파일 생성 (`build/pacts/`)
2. `pactPublish` 자동 실행 → Broker에 Pact 파일 업로드
3. `pactProviderTest` 실행 → Broker에서 Pact 파일 다운로드 → 검증

Provider 검증이 실패하면 빌드 전체가 실패한다. 이 시점에서 서버 A의 변경이 서버 B를 깨뜨린다는 사실이 배포 전에 드러나게 된다.


## 태그 기반 테스트 분리

Gradle Task에서 `includeTags`와 `excludeTags`를 사용하려면 테스트 클래스에 `@Tag` 어노테이션이 달려 있어야 한다.

문제는 Pact 테스트를 작성할 때마다 매번 `@Tag("pact-consumer")`나 `@Tag("pact-provider")`를 붙이는 게 번거롭고, 실수로 빼먹을 가능성이 있다는 점이었다.

### Abstract 클래스로 태그 적용

공통 abstract 클래스를 만들고 거기에 태그를 달아두는 방식으로 해결했다.

```kotlin
package com.nhn.inje.ccp.pact

import au.com.dius.pact.consumer.junit5.PactConsumerTest
import org.junit.jupiter.api.Tag

@PactConsumerTest
@Tag("pact-consumer")
abstract class PactConsumerTestBase
```

```kotlin
package com.nhn.inje.ccp.pact

import org.junit.jupiter.api.Tag

@Tag("pact-provider")
abstract class PactProviderTestBase
```

이 클래스들을 `core/common-pact` 모듈에 배치했다. Pact 테스트를 작성하는 모든 모듈에서 이 클래스를 의존성으로 가져와 사용할 수 있다.

### 사용 예시

Pact 테스트를 작성할 때는 해당 Base 클래스를 상속받기만 하면 된다.


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

이렇게 하면 모든 Pact 테스트가 동일한 태그를 갖게 되고, 태그를 붙이는 걸 깜빡할 가능성도 없어진다. 태그 이름을 바꾸거나 추가 설정이 필요하면 Base 클래스만 수정하면 된다.


## 일반 테스트와의 분리

마지막으로 일반 테스트(`./gradlew test`)에서는 Pact 테스트를 제외하도록 설정했다.

```kotlin
tasks.named<Test>("test") {
  useJUnitPlatform {
    excludeTags("pact-consumer", "pact-provider")
  }
}
```

이렇게 하면 일반 단위 테스트는 빠르게 실행할 수 있고, Pact 테스트는 명시적으로 `pactTest`를 실행할 때만 돌아간다. CI/CD 파이프라인에서 단계별로 제어하기도 쉬워진다.
