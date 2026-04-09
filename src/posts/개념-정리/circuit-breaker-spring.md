---
title: "Spring + Resilience4j로 서킷브레이커 적용하기"
date: 2026-04-08
tags: [circuit-breaker, fault-tolerance, msa]
order: 7
---

Spring에서는 보통 Resilience4j와 Spring Boot AOP 조합으로 서킷브레이커를 적용한다. 메서드 앞에 프록시가 끼어들어서 호출 전 상태 확인, 호출 실행, 결과 기록, 상태 전환을 대신 처리해주는 구조다. `resilience4j-spring-boot3`, `spring-boot-starter-aop`, `spring-boot-starter-actuator` 조합으로 시작한다.

## 코드에서 제일 먼저 보이는 형태

보통 서비스 메서드에 이렇게 붙는다.

```java
@Service
@RequiredArgsConstructor
public class PaymentService {

    private final PaymentClient paymentClient;

    @CircuitBreaker(name = "paymentApi", fallbackMethod = "approveFallback")
    public PaymentResponse approve(PaymentRequest request) {
        return paymentClient.approve(request);
    }

    public PaymentResponse approveFallback(PaymentRequest request, Throwable t) {
        throw new IllegalStateException("결제 연동이 현재 불안정합니다.", t);
    }
}
```

핵심은 두 개다. `name = "paymentApi"`는 이 이름으로 설정과 메트릭이 연결된다. `fallbackMethod`는 서킷이 열려 있거나 호출이 실패했을 때 대체 로직으로 빠지는 메서드다. 설정은 `application.yml`의 `resilience4j.circuitbreaker.instances.<name>` 아래로 붙는다.

## 요청이 들어오면 Spring 안에서 실제로 뭘 하는가

`approve()`가 바로 실행되는 게 아니었다. 이런 순서로 갔다.

``` mermaid
sequenceDiagram
    participant Client as 호출자
    participant Proxy as AOP 프록시
    participant CB as CircuitBreaker<br/>(paymentApi)
    participant Svc as PaymentService
    participant Ext as PaymentClient

    Client->>Proxy: approve(request)
    Proxy->>CB: 상태 확인
    alt CLOSED 또는 HALF_OPEN 허용
        CB-->>Proxy: 호출 허용
        Proxy->>Svc: approve(request) 실행
        Svc->>Ext: paymentClient.approve()
        Ext-->>Svc: 응답
        Svc-->>Proxy: 결과 반환
        Proxy->>CB: 성공/실패 기록 + 상태 갱신
        Proxy-->>Client: 응답 반환
    else OPEN
        CB-->>Proxy: 호출 차단
        Proxy->>Svc: approveFallback(request, t)
        Svc-->>Proxy: fallback 결과
        Proxy-->>Client: fallback 반환
    end
```

비즈니스 메서드를 프록시가 감싸고 있는 구조다.

## application.yml 설정

가장 많이 보는 형태다.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentApi:
        slidingWindowType: COUNT_BASED
        slidingWindowSize: 10
        minimumNumberOfCalls: 5
        failureRateThreshold: 50
        waitDurationInOpenState: 30s
        permittedNumberOfCallsInHalfOpenState: 3
        registerHealthIndicator: true
  timelimiter:
    instances:
      paymentApi:
        timeoutDuration: 2s
        cancelRunningFuture: true
```

| 설정 | 의미 |
|---|---|
| `slidingWindowType` | 최근 N건 기준(COUNT_BASED)인지, 최근 N초 기준(TIME_BASED)인지 |
| `slidingWindowSize` | 윈도우 크기 |
| `minimumNumberOfCalls` | 표본이 이 수 이상 쌓여야 판단 |
| `failureRateThreshold` | 실패율 임계치 (%) |
| `waitDurationInOpenState` | Open 상태 유지 시간 |
| `permittedNumberOfCallsInHalfOpenState` | Half-Open에서 시험 허용할 호출 수 |

## paymentApi 예시로 보는 실제 흐름

위 설정이라면 최근 10건을 보고, 최소 5건 쌓여야 판단하고, 실패율 50% 넘으면 Open, Open 30초 유지, Half-Open에서는 3건만 시험한다.

처음에는 CLOSED 상태라서 프록시가 호출을 통과시킨다. `paymentClient.approve()`가 실행되고, 성공이면 성공 기록, 예외면 실패 기록이 남는다. 최근 10건 중 6건 실패하면 실패율 60%이므로 OPEN으로 전환된다. 그 다음 요청부터는 외부 호출을 보내지 않고 빠르게 fallback으로 간다. 30초가 지나면 HALF_OPEN으로 진입해서 3건만 시험적으로 통과시키고, 다 성공하면 CLOSED로 복귀하고, 다시 실패하면 OPEN으로 돌아간다.

## 실패로 뭘 잡을지도 설정할 수 있다

실무에서 중요한 부분이었다. Resilience4j는 어떤 예외를 실패로 기록할지 세밀하게 나눌 수 있었다.

```yaml
resilience4j:
  circuitbreaker:
    instances:
      paymentApi:
        recordExceptions:
          - java.io.IOException
          - java.util.concurrent.TimeoutException
        ignoreExceptions:
          - com.example.BusinessValidationException
```

비즈니스 검증 예외는 failure에서 빼고, 진짜 연동 장애 예외만 failure로 잡는 식이다. 모든 예외를 무조건 failure로 잡으면 서킷브레이커 통계가 왜곡될 수 있었다.

## TimeLimiter와 같이 쓰는 경우

실무에서는 보통 TimeLimiter도 같이 붙였다.

```java
@TimeLimiter(name = "paymentApi")
@CircuitBreaker(name = "paymentApi", fallbackMethod = "approveFallback")
public CompletableFuture<PaymentResponse> approveAsync(PaymentRequest request) {
    return CompletableFuture.supplyAsync(() -> paymentClient.approve(request));
}
```

TimeLimiter는 한 번의 호출을 너무 오래 기다리지 않게 하고, CircuitBreaker는 반복 실패가 보이면 아예 차단한다. 역할을 나눠 쓰는 것이었다.

## 모니터링

Spring Boot Actuator를 같이 붙이면 CircuitBreaker 상태와 이벤트를 볼 수 있었다. `resilience4j-micrometer`가 있으면 메트릭 수집도 자동 구성된다.

실무에서는 보통 이런 걸 봤다.

- 지금 `paymentApi`가 Open인지
- 얼마나 자주 Open 되는지
- fallback이 얼마나 자주 타는지
- Half-Open 복귀가 잘 되는지

코드만 붙이는 게 아니라 Actuator + Micrometer + Grafana까지 같이 봐야 했다.

## Spring Cloud Circuit Breaker와의 차이

Spring Boot에서 Resilience4j를 직접 쓰는 방식도 있고, Spring Cloud Circuit Breaker 추상화를 통해 Resilience4j를 밑단 구현체로 쓰는 방식도 있었다. `@CircuitBreaker` 붙이고 `resilience4j.*` 설정하는 쪽을 보고 있다면 "Resilience4j를 Spring에 붙여서 쓴다"로 이해하면 충분했다.

## 코드에서 서킷브레이커를 찾는 순서

Spring 프로젝트에서 서킷브레이커가 걸려 있는지 보려면 이 순서로 봤다.

1. `build.gradle`이나 `pom.xml`에 `resilience4j-spring-boot3`, `spring-boot-starter-aop`, `actuator`가 있는지 확인
2. 서비스 메서드에 `@CircuitBreaker(name = "...")`가 붙었는지 확인
3. `application.yml`에서 `resilience4j.circuitbreaker.instances.<name>` 설정 확인
4. fallback 메서드가 있는지 확인
5. Actuator나 메트릭으로 상태를 노출하는지 확인

## 참고

- [Resilience4j - Getting Started](https://resilience4j.readme.io/docs/getting-started-3)
- [Resilience4j - CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker)
- [Spring Cloud Circuit Breaker - Resilience4j](https://docs.spring.io/spring-cloud-circuitbreaker/docs/current/reference/html/spring-cloud-circuitbreaker-resilience4j.html)
