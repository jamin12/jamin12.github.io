---
title: 대용량 데이터 다운로드
date: 2024-10-06
tags: [대용량-데이터, 비동기, 영속성, OOM, StreamingResponseBody]
---

서버 환경은 t3.medium이고, 롤링 배포를 위한 메모리를 빼면 실제 사용할 수 있는 메모리는 2GB 정도였다.

![image](./images/bulk-download-1.png)

약 1000만 건(작성 날짜 기준 최대 4000만 건)의 데이터를 CSV 파일로 다운로드해야 하는 기능에서 OOM이 발생했다.

![image](./images/bulk-download-2.png)

처음에는 과거 데이터가 변하지 않으니 미리 파일을 만들어놓으면 될 거라 생각했다. 하지만 사용자의 선택에 따라 컬럼값, 날짜, 관제점 등이 바뀌어야 했고, 미리 만들어놓는 건 현실적으로 불가능했다. 서버를 안전하게 굴리기 위해 데이터가 아무리 많아도 서버가 터지지 않게 만드는 게 목표였다.

## Repository 변경 시도

처음 구조는 대용량 데이터를 한번에 리스트로 메모리에 올리는 방식이었다.

```java
return getControlPointAndVlaueJpaQuery()
    .where(controlValue.controlPointId.in(controlPointIds),
        controlValue.collectedAt.between(startDate, endDate))
    .fetch()
```

이러니 OOM이 날 수밖에 없었다. Stream으로 바꾸면 순차적으로 가져올 수 있을 거라 생각해서 `@Query` Stream과 QueryDSL Stream 두 가지를 시도했다.

```java
// @Query stream
@Query(...)
Stream<ControlPointAndValueWithFloorZoneQuery> streamAllBy(
    @Param("controlPointIds") List<Long> controlPointIds,
    @Param("startDate") LocalDateTime startDate,
    @Param("endDate") LocalDateTime endDate);
```

```java
// QueryDSL stream
return getControlPointAndVlaueJpaQuery()
    .where(controlValue.controlPointId.in(controlPointIds),
        controlValue.collectedAt.between(startDate, endDate))
    .stream();
```

세 가지 모두 OOM을 해결하지 못했다. Stream이라는 이름만 보면 순차적으로 한 줄씩 가져올 것 같지만, 두 가지 이유로 메모리가 터졌다.

첫째, **MySQL JDBC 드라이버의 기본 동작**이다. MySQL Connector/J는 쿼리를 실행하면 결과를 전부 클라이언트 메모리로 가져온 뒤 ResultSet으로 넘긴다. `fetchSize` 기본값이 0인데, MySQL에서 0은 "전부 가져와라"라는 의미다. Stream으로 받든 List로 받든 드라이버 단에서 이미 전체를 fetch해버린다. 진짜 row 단위 스트리밍을 하려면 `fetchSize`를 `Integer.MIN_VALUE`로 설정해야 한다. (참고로 PostgreSQL은 `fetchSize`를 설정하면 그 수만큼만 가져오고 다 소비하면 다음 batch를 가져오는 방식이라, 같은 코드라도 DB 드라이버에 따라 동작이 완전히 다르다.)

둘째, **JPA 영속성 컨텍스트(1차 캐시)**다. JPA는 트랜잭션이 열려 있는 동안 조회된 엔티티를 전부 1차 캐시에 보관한다. 변경 감지(dirty checking)를 위해서다. 설령 JDBC 레벨에서 순차적으로 가져오더라도, Stream으로 1000만 건을 순회하면 1000만 개의 엔티티가 1차 캐시에 쌓인다. 이 문제는 뒤에서 `entityManager.detach()`로 해결했다.

## 호출 쪼개기 및 쿼리 튜닝

너무 많은 데이터를 한번에 조회하는 게 문제라고 판단해서, 넓은 기간의 데이터를 한 번에 가져오는 대신 기간을 쪼개서 순차적으로 가져오도록 변경했다.

```java
LocalDate startDate = rawDataDownLoadRequest.startDate();
LocalDate endDate = rawDataDownLoadRequest.endDate();

while (!startDate.isAfter(endDate)) {
    LocalDate nextDate = startDate.plusDays(10);
    if (nextDate.isAfter(endDate)) {
        nextDate = endDate;
    }
}
```

쿼리도 튜닝했다. 1000만 건 중에서 관제점별로 실제로 다른 값은 `controlValue.id`, `controlValue.collectedAt`, `controlValue.value` 세 개뿐이고 나머지는 전부 똑같은 데이터가 반복되고 있었다. 반복되는 데이터를 최소화하고 인덱스를 적용해서 쿼리 성능을 높였다.

```java
getQueryFactory()
    .select(
        Projections.constructor(
            ControlPointAndValueWithFloorZoneQuery.class,
            controlPoint.id,
            controlPoint.building.id,
            controlPoint.name,
            controlPoint.valueType,
            controlPoint.controlPointType,
            controlPoint.sortationType,
            controlPoint.purposeType,
            controlPoint.itemType,
            controlPoint.itemName,
            controlPoint.itemUnit,
            controlPoint.isUsageRole,
            controlPoint.isFeeRole,
            zone.id,
            parentZone.id,
            floor.id,
            floor.num,
            floor.floorType,
            zone.name,
            parentZone.name,
            controlValue.id,
            controlValue.collectedAt,
            controlValue.value
        )
    )
    .from(controlPoint)
    .join(zone).on(controlPoint.zone.id.eq(zone.id))
    .leftJoin(parentZone).on(zone.parent.id.eq(parentZone.id))
    .join(floor).on(zone.floor.id.eq(floor.id))
    .join(controlValue).on(controlPoint.id.eq(controlValue.controlPointId));
```

반복되는 관제점 데이터는 Map에 한 번만 담아두고, Stream으로 들어오는 관제값마다 Map에서 꺼내서 조합하는 방식이다.

## StreamingResponseBody로 순차 전송

기존에는 모든 데이터를 StringWriter에 담고 바이트로 변환해서 한번에 전송하는 방식이었다.

```java
try (StringWriter writer = new StringWriter();
     CSVPrinter csvPrinter = new CSVPrinter(writer, CSVFormat.DEFAULT)) {
    getHeader(rawDataDownLoadRequest, csvPrinter);
    getBody(rawDataDownLoadRequest, controlPointAndValueResponses, csvPrinter);
    ...
    InputStream byteArrayInputStream = new ByteArrayInputStream(outputBytes);
    return new InputStreamResource(byteArrayInputStream);
```

한번에 모두 보내는 게 아니라 순차적으로 데이터를 보내야 메모리에 부담이 없을 거라 생각했다. **StreamingResponseBody**를 사용해서 데이터를 받을 때마다 flush를 호출해 순차적으로 클라이언트에게 전송하도록 변경했다.

`StreamingResponseBody`는 Spring이 서블릿 스레드에서 응답을 바로 완료하지 않고, 별도의 비동기 스레드에서 `outputStream`에 데이터를 쓰도록 위임하는 구조다. 일반 응답이 데이터를 전부 메모리에 올려놓고 한방에 보내는 거라면, `StreamingResponseBody`는 수도꼭지를 틀어서 나오는 대로 바로 흘려보내는 방식이다.

내부 흐름을 보면:

1. 서블릿 스레드가 컨트롤러를 실행하고 `StreamingResponseBody` 람다를 반환한다 (아직 실행 안 됨)
2. Spring이 서블릿의 `AsyncContext`를 시작한다. HTTP 연결은 열어둔 채 서블릿 스레드는 반납된다
3. 비동기 스레드 풀에서 스레드를 꺼내 람다를 실행한다. 이때 Spring이 열려있는 HTTP 연결의 `OutputStream`을 람다에 넘겨준다
4. 람다 실행이 끝나면 Spring이 `asyncContext.complete()`를 호출해 HTTP 연결을 종료한다

코드에서 쓰이는 각 계층의 역할은 이렇다:

- **CSVPrinter** → 데이터를 CSV 문자열로 포맷팅
- **OutputStreamWriter** → 문자열을 UTF-8 바이트로 변환
- **OutputStream** → 바이트를 클라이언트로 전송 (Spring이 넘겨준 HTTP 연결 통로)

`csvPrinter.flush()`를 호출하면 CSVPrinter → OutputStreamWriter → OutputStream 순서로 버퍼를 밀어내서, 데이터가 네트워크를 타고 클라이언트까지 즉시 도달한다.

```java
@Transactional(readOnly = true)
public StreamingResponseBody getRawDataToCsv(RawDataDownLoadRequest rawDataDownLoadRequest,
    HttpServletRequest httpServletRequest) {
    return outputStream -> {
        try (OutputStreamWriter writer = new OutputStreamWriter(outputStream, StandardCharsets.UTF_8);
             CSVPrinter csvPrinter = new CSVPrinter(writer, CSVFormat.DEFAULT)) {
            getHeader(rawDataDownLoadRequest, csvPrinter);
            csvPrinter.flush();

            try (Stream<ControlValue> scrollableResults = controlPointService.getRawData(
                controlPointMap.keySet().stream().toList(),
                startDate, nextDate);) {
                scrollableResults.forEach(controlValue -> {
                    try {
                        getBody(rawDataDownLoadRequest, controlPointResponse, controlValue, csvPrinter);
                        csvPrinter.flush();
                    } catch (IOException e) {
                        throw new FileInputStreamException(FAILED_CREATE_FILE.getMessage());
                    }
                });
            }
        }
    };
}
```

### @Transactional과 비동기 스레드의 관계

여기서 한 가지 짚고 넘어갈 부분이 있다. `@Transactional(readOnly = true)`이 메서드에 걸려있지만, 이 트랜잭션이 람다 안의 코드까지 감싸지는 않는다.

`@Transactional`은 AOP 프록시로 동작한다. 메서드가 return하는 순간 트랜잭션이 커밋되고 닫힌다. 그런데 이 메서드가 return하는 건 람다 객체일 뿐이고, 람다 안의 코드는 아직 실행되지 않았다. Spring MVC가 반환 타입이 `StreamingResponseBody`인 걸 확인한 뒤 비동기 스레드 풀에서 람다를 실행하는데, 이 시점에는 이미 트랜잭션이 끝난 상태다.

```
서블릿 스레드:
  1. getRawDataToCsv() 호출 → 트랜잭션 시작
  2. 람다 객체 return → 트랜잭션 종료
  3. Spring MVC가 StreamingResponseBody 감지 → startAsync()
  4. 서블릿 스레드 반납

비동기 스레드:
  5. 람다 실행 (DB 조회, CSV 쓰기) → 트랜잭션 없음
```

비동기 전환은 컨트롤러가 `StreamingResponseBody`를 return한 뒤에 일어난다. 서비스 메서드 실행 전이 아니다. 그래서 람다 안에서 호출되는 `controlPointService.getRawData()` 등은 자체적으로 트랜잭션을 가져가서 동작한다.

## 영속성 캐시 문제

여기까지 적용하고 테스트했는데, 데이터가 순차적으로 잘 들어가다가 또 OOM이 발생했다.

이것저것 찾아보다가 조회한 데이터들이 영속성 컨텍스트(1차 캐시)에 남아 메모리를 차지하고 있는 것으로 예상했다. 영속성 컨텍스트는 JPA가 엔티티의 변경 감지(dirty checking)를 위해 조회한 엔티티를 보관하는 내부 구조다. `@Transactional(readOnly = true)`를 쓰더라도 변경 감지를 안 할 뿐 엔티티는 여전히 1차 캐시에 올라간다.

정확히 말하면 1차 캐시는 트랜잭션의 기능이 아니라 **EntityManager의 기능**이다. EntityManager가 열려있으면 트랜잭션이 없어도 1차 캐시는 동작한다. JPA는 "같은 PK로 조회하면 같은 객체를 반환한다"는 동일성 보장을 해야 하기 때문에, 조회한 엔티티를 내부 Map에 무조건 등록한다.

보통은 트랜잭션이 끝나면 EntityManager도 닫히면서 1차 캐시가 정리된다(Transaction-scoped Persistence Context). 하지만 여기서는 JPA Stream이 EntityManager를 붙잡고 있었다. Stream은 내부적으로 JDBC 커서를 유지하기 위해 EntityManager와 커넥션을 Stream이 닫힐 때까지 놓지 않는다. 기간을 10일 단위로 쪼개서 Stream을 열고 닫았지만, Stream이 닫혀도 EntityManager 자체는 살아있기 때문에 1차 캐시에 쌓인 엔티티가 청크를 넘어 계속 누적되었다.

여기서 `flush`와 `clear`의 차이를 알아야 한다. `flush`는 영속성 컨텍스트에 쌓인 변경사항을 DB에 SQL로 날리는 것이고 1차 캐시는 그대로 유지된다. `clear`는 1차 캐시를 통째로 비우는 것이고 DB에는 아무 일도 안 일어난다. 지금은 조회 전용(`readOnly = true`)이라 DB에 보낼 변경사항이 없으므로, `detach`로 처리 끝난 엔티티를 하나씩 빼고 마지막에 `clear`로 전체를 정리하면 된다.

```java
try (Stream<ControlValue> scrollableResults = controlPointService.getRawData(
    controlPointMap.keySet().stream().toList(),
    startDate, nextDate);) {
    scrollableResults.forEach(controlValue -> {
        ControlPointResponse controlPointResponse = controlPointMap.get(
            controlValue.getControlPointId());
        try {
            getBody(rawDataDownLoadRequest, controlPointResponse, controlValue, csvPrinter);
            csvPrinter.flush();
            entityManager.detach(controlValue);
        } catch (IOException e) {
            throw new FileInputStreamException(FAILED_CREATE_FILE.getMessage());
        }
    });
}
entityManager.clear();
```

## 비동기 스레드 풀 제한

하나의 요청에는 잘 대응할 수 있게 됐지만, 여러 사람이 동시에 다운로드를 하면 여전히 OOM이 발생했다.

처음에는 Java의 **Semaphore**로 동시에 접근하는 스레드 수를 제한하려 했다. 그런데 응답이 비동기로 이루어져 있어서 스레드를 컨트롤하기 어려웠다. Semaphore를 조사하면서 비동기 작업이 서블릿 스레드가 아닌 `SimpleAsyncTaskExecutor`에서 스레드를 매번 새로 만들어 사용하고 있다는 걸 알게 되었다. `SimpleAsyncTaskExecutor`는 스레드 풀이 아니라 요청마다 새 스레드를 무한정 생성하는 구조라, 동시에 다운로드하는 사람이 늘어나면 스레드와 메모리가 제한 없이 늘어났던 거다.

`ThreadPoolTaskExecutor`로 교체하고 `configureAsyncSupport`에 등록했다. `configureAsyncSupport`는 Spring MVC의 비동기 응답 전용 설정이라, `StreamingResponseBody`를 처리할 때 이 executor만 사용한다. `maxPoolSize(5)`로 설정하면 동시에 5개까지만 다운로드가 실행되고, 6번째 요청은 앞의 다운로드가 끝날 때까지 큐에서 대기한다.

```java
@Override
public AsyncTaskExecutor getAsyncExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(5);
    executor.setThreadNamePrefix("ASYNC-");
    executor.initialize();
    return executor;
}

@Override
public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
    configurer.setTaskExecutor(Objects.requireNonNull(getAsyncExecutor()));
    configurer.setDefaultTimeout(600000);
}
```

### 스레드 풀 큐와 에러 처리

`ThreadPoolTaskExecutor`의 기본 `queueCapacity`는 `Integer.MAX_VALUE`(약 21억)다. 동작 순서가 `corePoolSize`까지 스레드 생성 → 큐에 넣음 → 큐가 차면 `maxPoolSize`까지 스레드 추가 생성인데, 큐가 21억 개니까 `maxPoolSize(5)`에 도달할 일이 없다. 사실상 항상 2개 스레드로만 돌아간다.

큐까지 꽉 차면 기본 정책은 `AbortPolicy`로, `RejectedExecutionException`을 던진다. 문제는 이 예외가 컨트롤러가 정상 return한 뒤 Spring MVC 내부에서 터지기 때문에 `@ControllerAdvice`로 잡을 수 없다는 것이다. 비동기 스레드에서 터진 예외는 클라이언트에게 정상적인 에러 응답으로 전달되지 않는다.

CSV 다운로드 도중 예외가 터지면 HTTP 상태 코드는 응답 시작 시점에 이미 200으로 나갔기 때문에, 중간에 500으로 바꿀 수 없다. 클라이언트는 다운로드가 중간에 끊긴 불완전한 파일을 받게 된다.

그래서 비동기 영역에 들어가기 전, 컨트롤러 단에서 동시 다운로드 수를 직접 체크하는 게 가장 현실적이다.

```java
private final AtomicInteger activeDownloads = new AtomicInteger(0);
private static final int MAX_CONCURRENT = 5;

@GetMapping("/download")
public ResponseEntity<?> download(RawDataDownLoadRequest request) {
    if (activeDownloads.get() >= MAX_CONCURRENT) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body("현재 다운로드 요청이 많아 처리할 수 없습니다. 잠시 후 다시 시도해주세요.");
    }

    activeDownloads.incrementAndGet();
    StreamingResponseBody body = outputStream -> {
        try {
            rawDataService.writeCsv(request, outputStream);
        } finally {
            activeDownloads.decrementAndGet();
        }
    };

    return ResponseEntity.ok()
        .contentType(MediaType.parseMediaType("text/csv"))
        .body(body);
}
```

비동기 스레드 풀에 넘기기 전에 카운터로 먼저 체크하면, 초과 시 503 응답을 정상적으로 내려줄 수 있다.
