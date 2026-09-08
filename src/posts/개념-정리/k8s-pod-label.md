---
title: Pod Label
date: 2025-07-01
tags: [k8s, pod, label]
summary: Service와 Deployment가 파드를 고르는 기준인 Label과 Annotation의 차이
order: 32
---
**Label은 Kubernetes 오브젝트에 부여하는 key-value 쌍의 메타데이터**입니다.
이 중에서도 **Pod Label**은 파드를 식별하고 분류하는 데 가장 널리 사용됩니다.

- Label은 이름표 같은 역할을 합니다.
- 다양한 Kubernetes 기능(예: 서비스, 셀렉터, 오토스케일러 등)이 Label을 기반으로 동작합니다.

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: my-app
  labels:
    app: web
    tier: frontend
    environment: production
spec:
  containers:
  - name: nginx
    image: nginx:latest
```

- `app: web`은 이 파드가 웹 애플리케이션에 속한다는 의미
- `tier: frontend`는 이 파드가 프론트엔드 계층이라는 의미
- `environment: production`은 운영환경에 속한다는 의미

## 서비스 연결

서비스(Service)는 Label을 이용해 어떤 파드로 트래픽을 보낼지 결정합니다.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend-service
spec:
  selector:
    app: web
    tier: frontend
  ports:
  - port: 80
    targetPort: 80
```

`app=web`, `tier=frontend` 라벨을 가진 모든 파드로 요청을 전달합니다.

## 디플로이먼트 관리

Deployment는 Label을 통해 자신이 관리하는 파드를 추적합니다.

```yaml
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
```

`app=web` 라벨이 있는 파드만 이 디플로이먼트의 관리 대상이 됩니다.

## Label vs Annotation 차이

| 항목     | Label             | Annotation       |
| ------ | ----------------- | ---------------- |
| 목적     | 선택과 필터링 (셀렉터에 사용) | 설명 또는 부가 정보 저장용  |
| 사용 예시  | 서비스 연결, 셀렉터, 정책   | 배포 히스토리, 모니터링 정보 |
| 크기 제한  | 작고 단순해야 함         | 길고 복잡한 정보도 가능    |
| 검색 가능성 | 셀렉터에 사용 가능        | 셀렉터에서 사용 불가      |
