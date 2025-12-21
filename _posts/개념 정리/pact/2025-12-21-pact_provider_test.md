---
layout: post
title: "pact provider test"
date: 2025-12-21
categories: [개념정리, pact]
tags: [cdc, pact, 러너스하이2_주제1]
mermaid: true
---

Pact에서 Provider 테스트는 Consumer가 만든 계약을 검증하는 단계다.  
계약은 이미 Consumer 테스트 단계에서 만들어져 있고, Provider는 그 계약을 지금도 만족하는지를 확인한다.

이 단계에서 새로운 계약이 생성되지는 않는다.  
검증의 결과는 성공 또는 실패뿐이다.

## Pact file

Provider 테스트의 시작점은 pact file이다.

- Consumer 테스트가 성공적으로 실행되었고
- 그 결과로 pact file이 생성되어 있으며
- 이 파일이 로컬 디렉터리나 Pact Broker에 존재해야 한다

Provider 테스트는 이 pact file을 입력값으로 사용한다.

```kotlin
@Provider("kube-management")
@PactFolder("../build/pacts")
```

여기서 Provider 이름은 pact file 안의 `provider.name`과 정확히 일치해야 한다. 일치하지 않으면 Pact는 이 테스트가 어떤 계약을 검증해야 하는지 알 수 없다.

## Provider 테스트는 @TestTemplate 기반이다

Provider 테스트에는 일반적인 `@Test`가 없다.

```kotlin
@TestTemplate
fun verifyPact(context: PactVerificationContext) {
  context.verifyInteraction()
}
```

이 메서드는 한 번만 실행되지 않는다.

- pact file 안에 interaction이 여러 개 있으면
- 이 메서드는 interaction 수만큼 반복 실행된다

`@TestTemplate`은 테스트를 여러 번 실행하기 위한 틀이다.
실제 몇 번 실행될지는 확장이 결정한다.

여기서는 Pact 확장이 interaction 단위로 실행 컨텍스트를 제공한다.

## PactVerificationSpring6Provider의 역할

`PactVerificationSpring6Provider`는 Provider 테스트의 실행 엔진이다.

이 확장이 하는 일은 정리하면 다음과 같다.

- pact file을 로딩한다
- Provider 이름이 일치하는 pact만 선별한다
- pact 안의 interaction 목록을 만든다
- interaction 하나당 하나의 실행 컨텍스트를 만든다
- `@TestTemplate`을 interaction 수만큼 실행한다
- interaction에 provider state가 있으면 해당 `@State` 메서드를 실행한다
- `PactVerificationContext`를 생성해 테스트 메서드에 전달한다

이 확장이 없으면 `@TestTemplate`은 아무 의미가 없다.
반복 실행의 기준과 실행 맥락을 제공하는 주체가 이 확장이다.

## SpringExtension의 역할

`SpringExtension`은 JUnit 5 테스트를 Spring TestContext와 연결한다.

이 확장이 없으면 다음이 불가능하다.

- `@WebMvcTest` 사용
- `@MockBean` 사용
- `WebApplicationContext` 주입
- Spring이 관리하는 MVC 인프라 사용

Provider 테스트에서 SpringExtension은 Pact와 직접적인 관련은 없다.
Spring MVC 환경을 만들고 유지하는 역할만 한다.

## 왜 @WebMvcTest를 사용하는지

Provider 테스트에서 전체 애플리케이션 컨텍스트를 띄우는 선택지는 항상 무겁다.

`@SpringBootTest`를 사용하면 다음 문제가 생긴다.

- DB 설정이 필요해진다
- Redis나 외부 인프라 설정이 엮인다
- 테스트 실패 원인이 계약이 아닌 환경 문제가 된다

그래서 웹 레이어만 검증하는 방향으로 접근했다.

```kotlin
@WebMvcTest(controllers = [NamespaceV1Controller::class])
```

이 설정으로 로딩되는 것은 다음뿐이다.

- Controller
- MVC 인프라
- ArgumentResolver
- MessageConverter
- MockMvc

Service, Repository, DB, Redis는 로딩되지 않는다.
Provider 테스트의 목적에는 이 정도가 충분했다.

## @State는 무엇이고 왜 등장하는가

Consumer는 interaction을 정의할 때 전제 조건을 함께 적을 수 있다.

```kotlin
given("project has unassigned namespaces")
```

이 문장은 요청 자체의 일부가 아니다.
이 요청이 의미를 가지는 조건을 설명한다.

Provider 테스트에서는 이 조건을 실제 상태로 만들어야 한다.

```kotlin
@State("project has unassigned namespaces")
fun projectHasUnassignedNamespaces() {
  // 상태 준비
}
```

여기서 상태란 DB 상태일 수도 있고,
Mock으로 구성된 내부 동작일 수도 있다.

중요한 점은 이 메서드가 호출되는 시점이다.

- interaction 하나를 검증하기 직전에
- Pact 확장이 자동으로 호출한다

Provider 테스트는 이 메서드를 통해
“지금 이 요청이 실행 가능하다”는 환경을 만든다.

## PactVerificationContext란 무엇인가

`PactVerificationContext`는 지금 검증 중인 interaction 하나를 대표하는 객체다.

이 객체 안에는 다음 정보가 들어 있다.

- 현재 interaction의 요청 정보
- 기대되는 응답 정보
- 검증 로직
- 검증 대상(Target)

Provider 테스트에서 이 객체를 직접 다루는 이유는 단순하다.

- 검증 대상(Target)을 지정해야 하고
- 검증을 실행해야 하기 때문이다

```kotlin
context.target = Spring6MockMvcTestTarget(mockMvc)
context.verifyInteraction()
```

이 두 줄이 Provider 테스트의 핵심이다.

## WebApplicationContext는 무엇인가

`WebApplicationContext`는 Spring MVC 테스트용 컨텍스트다.

`@WebMvcTest`로 구성된 MVC 환경 전체를 담고 있다.

- Controller
- DispatcherServlet
- ArgumentResolver
- MessageConverter

MockMvc를 만들 때 이 컨텍스트가 필요하다.

``` kotlin
MockMvcBuilders.webAppContextSetup(webApplicationContext)
```

이 컨텍스트는 Pact와 직접적인 관련은 없다.
MockMvc를 통해 컨트롤러를 실행하기 위한 기반일 뿐이다.

## 두 컨텍스트가 만나는 지점

`@BeforeEach`는 두 컨텍스트를 연결하는 위치다.

- Spring이 만든 MVC 환경으로 MockMvc를 만들고
- Pact가 만든 검증 컨텍스트에 그 MockMvc를 Target으로 등록한다

``` kotlin
context.target = Spring6MockMvcTestTarget(mockMvc)
```

이 한 줄로 Pact는 HTTP 서버 대신
Spring MVC 내부 호출을 사용하게 된다.

## interaction 하나가 검증되는 전체 흐름

interaction 하나가 검증될 때의 흐름은 다음과 같다.

1. Pact가 pact file에서 interaction 하나를 선택한다
2. 해당 interaction에 provider state가 있으면 `@State`를 실행한다
3. `@BeforeEach`가 실행되어 MockMvc target이 설정된다
4. Pact가 요청을 target으로 전달한다
5. 응답을 계약과 비교한다

이 과정을 interaction 수만큼 반복한다.

## 참고

{% include link-preview.html url="https://docs.pact.io/implementation_guides/jvm/provider/junit5spring" title="Pact JUnit 5 Spring Provider Documentation" %}

{% include link-preview.html url="https://docs.pact.io/implementation_guides/jvm/provider/spring6" title="Pact Spring 6 Provider Documentation" %}