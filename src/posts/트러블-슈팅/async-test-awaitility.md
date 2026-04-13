---
title: 비동기 테스트 처리
date: 2024-10-07
tags: [테스트, 비동기, awaitility, transactional]
---

A를 저장하면 B가 같이 저장되어야 하는, 서로 다른 도메인이 하나의 로직처럼 실행되어야 하는 상황이 생겼다.

[회원시스템 이벤트기반 아키텍처 구축하기 | 우아한형제들 기술블로그](https://techblog.woowahan.com/7835/)

위 글을 참고하면서 관심사 분리를 위해 Spring Event를 활용해서 구현했다. 그런데 이벤트 리스너를 비동기로 처리하다 보니, 이번에는 테스트에서 문제가 터졌다.

## Awaitility

이벤트를 활용하면서 B가 저장되는 이벤트는 비동기로 처리되고 있었다. 이 메서드를 테스트하기 위해 저장을 하고 조회를 해야 했는데, 코드는 이렇게 생겼었다.

```java
// 비동기 메서드
zoneManageHandler.controlPointCreateHandle();
// 저장 확인을 위한 조회
List<ZoneManage> zoneManages = zoneManageRepository.findAll();
```

비동기 메서드가 호출되고 난 뒤 기다리지 않고 바로 `findAll`을 하고 있어서 저장된 값이 제대로 조회되지 않았다. 비동기 스레드에서 저장이 끝나기 전에 메인 테스트 스레드가 조회를 끝내버리니 계속 실패할 수밖에 없었다.

즉, 저장이 될 때까지 기다렸다가 이후에 조회를 해야 제대로 된 테스트가 가능한 상황이었다. 비동기 메서드 테스트에 대한 여러 글을 찾아보다가 **Awaitility**라는 비동기 테스트 전용 라이브러리를 알게 되었다.

이 라이브러리를 사용하면 "언제까지, 어떤 조건이 될 때까지 폴링하면서 기다린다"를 한 줄로 표현할 수 있다. `Thread.sleep`으로 임의 시간을 박아두는 것과 달리, 조건이 만족되는 즉시 통과하기 때문에 테스트 속도와 안정성을 동시에 잡을 수 있다.

```java
// 최대 5초 동안 조건이 만족될 때까지 반복해서 확인한다
await().atMost(5, TimeUnit.SECONDS).until(() -> {
    List<ZoneManage> zoneManages = zoneManageRepository.findAll();
    return zoneManages.size() == 3;
});
```

테스트 코드를 이렇게 변경했고 이제 되겠지 했지만, 여전히 실패하고 있었다.

## Transactional 문제

실패의 원인은 Awaitility가 아니라 `@Transactional`에 있었다.

```java
@Test
@Transactional
void 테스트() throws Exception {
    // given
    zoneManageRepository.saveAll(List.of(...));
    zoneManageHandler.controlPointCreateHandle();

    // then
    await().atMost(5, TimeUnit.SECONDS).until(() -> {
        List<ZoneManage> zoneManages = zoneManageRepository.findAll();
        return zoneManages.size() == 3;
    });
}
```

`saveAll`을 했을 때 테스트 메서드의 트랜잭션이 아직 커밋되지 않은 상태에서 비동기 메서드가 호출되기 때문에, 비동기 스레드에서는 저장된 값을 조회할 수 없었다. 비동기 스레드는 테스트 스레드와 다른 트랜잭션을 사용하고, 테스트 트랜잭션이 커밋되기 전까지 바깥에서는 그 데이터를 볼 수 없기 때문이다.

게다가 비동기 메서드에서 실행된 쓰기 작업은 테스트의 트랜잭션 범위 밖이기 때문에, 테스트가 끝날 때 자동으로 rollback이 되지도 않는다. 결과적으로 테스트 데이터가 DB에 그대로 남아 다음 테스트에 영향을 주는 문제까지 생겼다.

그래서 `@Transactional`을 빼고 바로 커밋이 되도록 한 다음, 테스트가 끝날 때마다 직접 테이블을 비워주는 방식으로 바꿔야 했다.

```java
// 모든 테이블 비우기
@Transactional
public void execute() {
    entityManager.flush();
    entityManager.createNativeQuery("SET foreign_key_checks = 0;").executeUpdate();

    for (String tableName : tableNames) {
        entityManager.createNativeQuery("TRUNCATE TABLE " + tableName).executeUpdate();
    }
    entityManager.createNativeQuery("SET foreign_key_checks = 1;").executeUpdate();
}

// 테스트가 끝날 때마다 호출
@AfterEach
void finish() {
    databaseCleanup.execute();
}
```

외래키 제약 때문에 `TRUNCATE`가 순서대로 동작하지 않을 수 있어서, 앞뒤로 `foreign_key_checks`를 껐다 켜는 처리를 했다. 이렇게 설정하고 실행해보니 테스트가 정상적으로 돌아가는 모습을 볼 수 있었다.

정리하면 비동기 이벤트가 얽힌 테스트에서는 두 가지가 같이 필요했다.

- **Awaitility** — 비동기 실행이 끝날 때까지 조건 기반으로 기다리기
- **트랜잭션 분리 + 수동 cleanup** — 비동기 스레드가 테스트 트랜잭션 밖에서 실행되는 구조를 인정하고, 롤백 대신 명시적 삭제로 상태를 정리

`@Transactional`은 편리하지만, 비동기가 섞이는 순간 "테스트 격리는 트랜잭션 롤백으로 한다"는 기본 전제가 깨진다는 걸 체감했다.

## 참고

- [비즈니스 로직에 집중하는 비동기 테스트 코드 작성](https://velog.io/@joosing/focus-on-business-logic-in-asynchronous-test-code)
- [회원시스템 이벤트기반 아키텍처 구축하기 | 우아한형제들](https://techblog.woowahan.com/7835/)
- [Awaitility Usage Wiki](https://github.com/awaitility/awaitility/wiki/Usage)
- [스프링 @Async와 @Transactional 테스트 이야기 | jojoldu](https://jojoldu.tistory.com/761)
