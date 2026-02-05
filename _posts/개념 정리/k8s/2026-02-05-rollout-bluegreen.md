---
layout: post
title: "Argo Rollouts - Blue-Green 배포"
date: 2026-02-05
categories: [개념정리, k8s]
tags: [kubernetes, argo-rollouts, blue-green, devops]
---

## 1. 아키텍처 구성

![Kubernetes Blue-Green Architecture](/assets/imgs/posts/개념정리/k8s/bluegreen_k8s_architecture.png)

activeService는 실제 사용자 트래픽을 받고, previewService는 배포 전 QA 검증에 사용된다.

## 2. 매니페스트 작성

### Rollout

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp-rollout
  labels:
    app: myapp
spec:
  replicas: 3
  revisionHistoryLimit: 2
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: nginx
        image: nginx:1.21.0
        ports:
        - containerPort: 80
        resources:
          requests:
            memory: "64Mi"
            cpu: "100m"
          limits:
            memory: "128Mi"
            cpu: "200m"
  strategy:
    blueGreen:
      activeService: myapp-active-svc
      previewService: myapp-preview-svc
      autoPromotionEnabled: false
      scaleDownDelaySeconds: 30
```

`autoPromotionEnabled: false`로 설정하면 수동 승인이 필요하다. `scaleDownDelaySeconds`는 트래픽 전환 후 이전 ReplicaSet을 유지하는 시간이다.

### Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-active-svc
spec:
  selector:
    app: myapp
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: myapp-preview-svc
spec:
  selector:
    app: myapp
  ports:
  - protocol: TCP
    port: 80
    targetPort: 80
```

두 Service의 selector가 동일하게 `app: myapp`으로 정의되어 있다. Argo Rollouts가 런타임에 `rollouts-pod-template-hash` 라벨을 추가하여 구분한다.

### previewService 없는 구성

previewService는 필수가 아니다. 배포 전 수동 검증이 필요 없다면 생략할 수 있다.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: myapp-rollout
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    # ... 생략
  strategy:
    blueGreen:
      activeService: myapp-active-svc
      # previewService 생략
      autoPromotionEnabled: true
```

`autoPromotionEnabled: true`로 설정하면 새 ReplicaSet의 health check가 통과되는 즉시 자동으로 트래픽이 전환된다.

| 구성 | previewService 있음 | previewService 없음 |
|------|---------------------|---------------------|
| QA 테스트 | 별도 URL로 테스트 가능 | 불가능 |
| 전환 방식 | 수동 Promote (검증 후) | 자동 Promote (health check만) |
| 안전성 | 높음 (사전 검증) | 보통 (health check 의존) |
| 속도 | 느림 (검증 시간) | 빠름 (즉시 전환) |

previewService가 있을 때는 새 ReplicaSet 생성 후 QA가 preview URL로 테스트하고 수동 Promote를 수행한다. 없을 때는 health check 통과 확인 후 자동으로 activeService가 전환된다.

CI/CD 파이프라인에서 충분한 테스트를 거쳤다면 previewService 없이 자동 배포하는 경우도 있다.

## 3. Service Selector 동작 방식

Service를 정의할 때 selector가 동일해도 Argo Rollouts가 자동으로 hash 라벨을 추가한다.

```yaml
# 정의한 내용
spec:
  selector:
    app: myapp

# Argo Rollouts가 변경한 내용
spec:
  selector:
    app: myapp
    rollouts-pod-template-hash: aaaa1111
```

Kubernetes selector는 AND 조건으로 동작하므로 두 조건을 모두 만족하는 Pod만 선택된다.

## 4. 배포 흐름

![Blue-Green Internal Flow](/assets/imgs/posts/개념정리/k8s/bluegreen_internal_flow.png)

### 초기 상태

``` text
activeService  ──▶ hash: aaaa1111 ──▶ Blue Pods (v1.0)
previewService ──▶ hash: aaaa1111 ──▶ Blue Pods (v1.0)
```

첫 배포 시에는 하나의 ReplicaSet만 존재하고, 두 Service 모두 같은 Pod를 바라본다.

### 새 버전 배포

```bash
kubectl argo rollouts set image myapp-rollout nginx=nginx:1.22.0
```

``` text
activeService  ──▶ hash: aaaa1111 ──▶ Blue Pods (v1.0)  ← 사용자
previewService ──▶ hash: bbbb2222 ──▶ Green Pods (v2.0) ← QA 테스트
```

새 ReplicaSet이 생성되고 previewService의 selector만 변경된다. 사용자 트래픽은 여전히 Blue로 향한다.

### Promote (트래픽 전환)

```bash
kubectl argo rollouts promote myapp-rollout
```

![Promote Detail](/assets/imgs/posts/개념정리/k8s/bluegreen_promote_detail.png)

``` text
activeService  ──▶ hash: bbbb2222 ──▶ Green Pods (v2.0) ← 사용자
previewService ──▶ hash: bbbb2222 ──▶ Green Pods (v2.0)
```

activeService의 selector가 새 hash로 변경된다. Pod는 그대로 유지되고 selector만 변경되므로 트래픽 전환이 즉시 이루어진다.

### Scale Down

`scaleDownDelaySeconds`에 설정된 시간이 지나면 이전 ReplicaSet의 replicas가 0으로 변경된다. `revisionHistoryLimit`만큼 ReplicaSet 히스토리가 보관되어 롤백에 사용된다.
