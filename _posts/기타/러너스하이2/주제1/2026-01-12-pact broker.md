---
layout: post
title: "Pact Broker 구성"
date: 2026-01-12
categories: [기타, 러너스하이2, 주제1]
tags: [cdc, 러너스하이2_주제1]
---

## Pact Broker에 대한 초기 오해

Pact Broker를 처음 접했을 때, 단순히 Consumer가 생성한 JSON 파일(Pact 파일)을 공유 스토리지에 저장하는 방식일 거라고 생각했다. 그래서 처음에는 공유 블록 스토리지에 파일을 올려두고 Producer가 이를 읽어가는 구조로 구성하려 했다.

그런데 자료를 찾아보니 Pact Broker는 단순한 파일 저장소가 아니었다. 별도의 컨테이너 애플리케이션으로 띄워야 하는 구조였고, 계약 버전 관리, 검증 결과 기록, Consumer-Provider 관계 시각화 같은 기능을 제공하는 서비스였다. 단순히 파일을 주고받는 것과는 성격이 달랐다.

## K8s Helm 차트로 구성

컨테이너로 띄워야 한다는 걸 파악한 후, K8s 환경에 맞춰 Helm 차트를 구성했다.

구성 요소는 다음과 같았다.

- **이미지**: `pactfoundation/pact-broker`
- **데이터베이스**: PostgreSQL (계약 데이터 저장용)
- **Service**: ClusterIP (9292 포트)
- **Ingress**: nginx ingress controller를 통해 외부 접근

Pact Broker는 내부적으로 PostgreSQL을 사용해서 계약 데이터를 저장한다. 단순 파일 저장소였다면 DB가 필요 없었겠지만, 버전 관리나 검증 이력 같은 기능 때문에 DB 연동이 필수였다.

## 도메인 없이 접근하는 문제

컨테이너로 띄우게 되면서 접근 주소가 필요해졌다. 일반적으로는 Ingress에 host를 지정해서 도메인으로 접근하는 방식을 쓴다.

문제는 도메인을 따로 받을 수 없는 상황이었다는 점이다.

해결 방법으로 Ingress에 host를 지정하지 않고, path 기반 라우팅만 사용했다. LoadBalancer의 IP를 직접 사용해서 접근하는 구조로 구성했다.

```yaml
ingress:
  path: /pact-broker(/|$)(.*)
  # host 지정 없음
```

그리고 Pact Broker가 자신의 URL을 인식할 수 있도록 `PACT_BROKER_PUBLIC_BASE_URL` 환경변수에 LB IP를 직접 지정했다.

```yaml
broker:
  publicBaseUrl: http://<LB_IP>/pact-broker
```

이렇게 하면 `http://<LB_IP>/pact-broker`로 접근할 수 있게 된다. 도메인 없이도 동작하는 구조가 만들어졌다.

## 현재 상태

Pact Broker가 K8s 환경에 배포되었고, LB IP를 통해 접근 가능한 상태다.
