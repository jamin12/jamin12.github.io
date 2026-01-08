---
layout: post
title: "runner server 구성"
date: 2025-12-30
categories: [기타, 러너스하이2, 주제3]
tags: [CI, 러너스하이2_주제3]
---

## Runner 인프라 개선

### 병렬 실행 한계와 대안

초기에는 기존 Runner 서버에서 Docker 기반으로 여러 Runner를 띄워 **병렬 실행**을 시도했다. 그러나 **4 vCore, 4GB Memory**라는 서버 스펙의 한계가 명확했다. Gradle 기반 Kotlin Spring 멀티모듈 빌드와 테스트 파이프라인은 단일 실행만으로도 리소스가 빠듯했기 때문이다. 실제로 병렬 실행 시 **Gradle Daemon이 소멸**하거나 컨테이너가 **OOM(Out of Memory)**으로 종료되는 현상이 발생하여 현실적인 적용이 불가능했다.

이에 서버 증설 대신 **사내 개발자들이 사용하는 MacBook을 Runner로 활용**하는 방안을 고안했다. GitHub Enterprise는 내부망 접근만 허용되며, VPN 환경에서만 Runner가 활성화되도록 제한할 수 있어 보안상 안전하다고 판단했다. CTO 승인 후, 각자의 Mac에서 **Self-hosted Runner**를 구동하여 CI 부하를 분산시키는 구조를 실험했다.

### Docker 환경 구성 및 프로세스 관리

개인 환경 편차를 최소화하기 위해 **Linux ARM64 기반의 Docker**로 Runner를 구성하고, Compose를 통해 GitHub Enterprise 엔드포인트와 연동했다. 초기에는 Runner를 상시 실행 프로세스로 두었으나, 컨테이너 비정상 종료 시 **오프라인 Runner**가 남는 문제가 발생하여 관리가 필요했다.

결국 Runner를 지속되는 서버가 아닌 CI Job 처리를 위한 **일회성 프로세스**로 관리하는 것이 적합하다고 판단했다. Runner 등록 시 `--ephemeral` 옵션을 적용하여 Job 처리 후 자동 종료되도록 설정하고, Docker의 `restart: unless-stopped` 옵션과 결합하여 컨테이너 재시작 시 자동으로 재등록되게 구성했다. 이를 통해 오프라인 Runner 정리 등 불필요한 관리 소요를 제거할 수 있었다.

## CI 메모리 안정화

### 원인 분석: 다수의 JVM 프로세스

Runner 구조 개선 후에도 `DaemonDisappearedException`과 같은 CI 실패가 지속되었다. 로그 분석 결과, 이는 Gradle 내부 문제가 아닌 **컨테이너 메모리 초과**로 인해 **Linux OOM Killer**가 JVM 프로세스를 강제 종료시킨 것이 원인이었다.

Gradle `:build` 실행 시 Gradle Client, Worker, Kotlin Compiler Daemon, Java Compiler, Test JVM(forked) 등 다수의 JVM 프로세스가 동시에 생성된다. 각 프로세스의 메모리 사용량이 합산되면 4GB를 쉽게 초과하므로, 개별 JVM 옵션을 명확히 제한하지 않으면 OOM 발생이 불가피했다.

### 메모리 최적화 적용

로컬 개발 환경의 성능 저하를 방지하기 위해 `build.gradle` 등의 파일에는 하드 리미트를 두지 않고, **CI 환경에서만 GitHub Actions Workflow의 `env` 등을 통해 설정을 오버라이드**했다. 구체적으로 `GRADLE_OPTS`를 통해 Daemon 및 병렬 빌드를 비활성화하고 Worker 수를 1로 제한했으며, `org.gradle.jvmargs`로 힙 메모리와 Metaspace를 명시적으로 설정했다. Test JVM 또한 CI 전용 초기화 스크립트로 제어하여, 로컬 설정에는 영향을 주지 않으면서 CI 환경에서의 메모리 사용 패턴을 단순화했다.

추가적으로 JDK 종류에 따른 메모리 사용량을 관찰했다. Zulu JDK 대비 **Temurin(Eclipse Adoptium)** 사용 시 동일 조건에서 메모리 사용이 다소 안정적인 경향을 보였기에, 현재 구성에서는 Temurin을 채택하여 운영 중이다.

마지막으로 Docker Runner 설정에서도 컨테이너 메모리 제한과 함께 **Swap 메모리**를 설정했다. JVM 레벨의 제어만으로는 순간적인 메모리 피크 시 컨테이너가 종료될 위험이 있어, Swap을 통해 완충 구간을 확보하여 안정성을 높였다.

## 팀 내 공유와 이후 정리

해당 설정 적용 후 CI는 안정화되었으며, 반복적인 테스트 빌드 시에도 OOM 등으로 인한 중단 현상은 발생하지 않았다. 이후 Runner 구성 방식과 CI 전용 JVM 옵션 등을 문서화하여 공유함으로써, 팀 전체가 동일한 환경과 기준으로 CI를 운영할 수 있는 체계를 마련했다.
