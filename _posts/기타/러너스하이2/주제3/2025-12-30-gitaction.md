---
layout: post
title: "runner server 구성"
date: 2025-12-30
categories: [기타, 러너스하이2, 주제3]
tags: [monitoring, 러너스하이2_주제3]
---

## 기존 runner 서버의 한계

처음에 고려한 방식은 단순했다.
기존 runner 서버에서 Docker 기반으로 runner를 여러 개 띄워 병렬 실행을 시도하는 것이었다.

문제는 서버 스펙이었다.

* 4 Core / 4GB Memory
* Gradle + Kotlin + Spring 멀티모듈 빌드
* 테스트까지 포함된 CI 파이프라인

단일 빌드도 간신히 버티는 환경에서 병렬 실행은 현실적으로 불가능했다.
실제로 시도해보면 Gradle daemon이 중간에 사라지거나, 컨테이너가 OOM으로 종료됐다.

## 접근 방식 변경

서버가 병목이라면, 서버를 늘릴 수 없을까를 고민하게 됐다.
그러다 떠오른 아이디어가 **개인 MacBook을 runner로 사용하는 방식**이었다.

* 개발자들은 이미 회사 MacBook을 사용하고 있다
* GitHub Enterprise는 내부망 접근만 가능하다
* VPN을 사용하는 환경에서만 runner가 활성화되도록 제한할 수 있다

이 정도 제약 사항이라면 보안 측면에서도 충분히 안전하다고 판단했고, CTO님의 검토를 거쳐 승인을 받았다.

각자의 Mac에서 self-hosted runner를 띄우고,
CI workload를 분산시키는 구조를 실험해보기로 했다.

## Docker 기반 self-hosted runner

개인 환경 차이를 줄이기 위해 runner는 Docker로 구성했다.

* Linux ARM64 기준
* Docker Compose로 여러 runner 컨테이너 실행 가능
* GitHub Enterprise endpoint 지정

처음에는 runner를 상시 실행 프로세스로 두었고,
job이 끝나도 runner가 계속 살아있는 구조였다.
이 상태에서 컨테이너가 비정상 종료되면 GitHub에는 offline runner가 남았다.

runner 정리 자체가 또 다른 관리 포인트가 되었다.

## runner lifecycle 문제

runner를 “서버”처럼 다루는 방식이 문제라는 판단이 들었다.
CI job을 처리하는 **소모성 프로세스**로 보는 게 맞다고 생각했다.

그래서 runner 등록 시 `--ephemeral` 옵션을 사용했다.

* job 1개 처리 후 runner 자동 종료
* GitHub에 offline runner가 남지 않음
* 컨테이너 재시작 시 자동 재등록

Docker의 `restart: unless-stopped` 옵션과 조합하니
runner lifecycle에 대한 관리 부담이 크게 줄었다.

이 시점부터 runner 자체는 거의 신경 쓰지 않아도 되는 상태가 됐다.

## 메모리 문제 재등장

runner 구조는 정리됐지만, CI는 여전히 자주 실패했다.
에러는 대부분 동일했다.

> DaemonDisappearedException

처음에는 Gradle 문제로 보였지만, 로그를 계속 추적하면서 인식이 바뀌었다.

이건 Gradle 내부 OOM이 아니었다.
컨테이너 메모리를 초과하면서 Linux OOM killer가 JVM 프로세스를 강제 종료한 것이었다.

즉, **프로세스 자체가 사라진 상황**이었다.

## 한 번의 빌드에서 동시에 뜨는 JVM들

Gradle `:build` 한 번을 실행해도 JVM은 여러 개가 동시에 뜬다.

* Gradle 실행 JVM
* Gradle worker JVM
* Kotlin compiler daemon
* Java compiler
* Test JVM (forked)
* 그 외 OS / Docker overhead

이 JVM들이 각각 메모리를 조금씩만 써도,
합산하면 4GB는 쉽게 넘는다.

개별 옵션을 명확히 나누지 않으면 결국 터진다는 결론에 가까워졌다.

## CI 전용 메모리 제한 전략

로컬 개발 환경의 성능은 유지하고 싶었다.
그래서 `build.gradle`이나 `gradle.properties`에는 메모리 관련 하드 제한을 두지 않았다.

CI에서는 상황이 달랐다.
제한 없이 실행하면 JVM들이 동시에 메모리를 점유하면서 컨테이너 한계를 넘는 문제가 반복됐다.

그래서 CI 환경에서만 Gradle 관련 설정을 전부 오버라이드하는 방향으로 정리했다.

* `gradle.properties`에 정의된 기본 JVM 옵션은 CI에서 사용하지 않음
* GitHub Actions workflow의 `env`와 실행 옵션으로만 제어
* JVM 종류별로 역할을 나누어 제한 적용

구체적으로는 다음과 같은 방식이었다.

* `GRADLE_OPTS`
  * Gradle daemon 비활성화
  * parallel 비활성화
  * worker 수 1로 제한
  * Kotlin compiler daemon 메모리 제한
* `org.gradle.jvmargs`
  * Gradle 실행 JVM heap / metaspace 명시적 제한
* Test JVM
  * CI 전용 init script에서만 제어

이 구조를 통해 로컬 개발 설정은 그대로 두고,
CI에서만 메모리 사용 패턴을 강제로 단순화할 수 있었다.

## JDK 선택

추가로 관찰한 부분은 JDK 종류였다.

Zulu JDK를 사용할 때 메모리 사용량이 상대적으로 컸다.
self-hosted, 저메모리 환경에서는 부담이 됐다.

Temurin(Eclipse Adoptium)으로 변경한 이후에는
동일 조건에서 메모리 사용이 다소 안정되는 경향을 보였다.

결정적인 수치 차이를 단정하긴 어렵지만,
현재 구조에서는 Temurin이 더 맞는 선택이라고 판단하고 유지 중이다.

## docker 스왑메모리 설정

Docker runner 설정에서도 메모리 사용을 한 번 더 제한했다.

컨테이너 메모리 limit 명시

swap 메모리 크기 제한 설정

JVM 레벨에서만 제어할 경우, 순간적인 메모리 사용량 증가로 컨테이너가 바로 종료되는 경우가 있었다. Docker 레벨에서 swap을 함께 설정해 두니, 메모리가 급격히 튀는 구간에서도 컨테이너가 즉시 종료되지 않고 버퍼 역할을 하게 됐다.

## 팀 내 공유와 이후 정리

이 설정으로 CI가 안정적으로 동작하는 수준까지는 도달했다.
테스트 빌드를 여러 번 반복해도, 이전처럼 Gradle daemon이 중간에 사라지거나 OOM으로 종료되는 상황은 발생하지 않았다.

공유 이후에는 개인 설정으로 남기지 않기 위해 몇 가지를 추가로 정리했다.

* runner 구성 방식 문서화
* CI 전용 JVM 옵션 정리
* 개인 Mac runner 사용 시 주의사항 정리

이 작업은 새로운 기능을 만드는 일이라기보다는, 팀이 같은 환경에서 같은 기준으로 CI를 사용할 수 있게 만드는 과정에 가까웠다.

지금은 이 구조를 팀 단위의 기본 CI 실행 방식으로 가져가고 있고, 필요에 따라 runner 수나 설정을 조정하면서 운영 중이다.
