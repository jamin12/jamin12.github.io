---
layout: post
title: "Prometeus 설치 (503 no healthy upstream)"
date: 2025-12-26
categories: [기타, 러너스하이2, 주제2]
tags: [monitoring, 러너스하이2_주제2]
---

## 상황

Prometheus를 설치한 뒤 `http://noo.prom.com`으로 접속을 시도했다.
Istio Ingress Gateway를 통해 접근했지만 브라우저에는 `503 Service Unavailable`가 출력됐고,
응답에는 `upstream connect error or disconnect/reset before headers`,
`no healthy upstream` 메시지가 함께 나타났다.

`no healthy upstream`은 Envoy가 트래픽을 전달할 수 있는 정상적인 백엔드 파드를 찾지 못했을 때 발생한다.
Ingress 설정 문제일 수도 있었지만, 우선 백엔드 상태부터 확인했다.

## Ingress 뒤의 상태 확인

Gateway와 VirtualService는 정상적으로 생성되어 있었고,
`kps-kube-prometheus-stack-prometheus` Service도 존재했다.

하지만 `kubectl get endpoints`로 확인해보니 엔드포인트가 비어 있었다.
Service 뒤에 연결될 Prometheus 파드가 준비되지 않은 상태였다.

파드를 직접 확인해보니 아예 생성되지 못하고 있었고,
이벤트 로그에는 다음 오류가 남아 있었다.

```text
FailedCreate: Pod "prometheus-kps-kube-prometheus-stack-prometheus-0" is invalid:
... volumeMounts[0].name: Not found: "prometheus-db"
```

## Prometheus 파드가 생성되지 않았던 이유

초기에는 initContainer를 사용해 볼륨 디렉터리의 권한을 직접 맞추는 방식으로 접근했다.
Prometheus가 데이터를 쓰는 경로에 대해 `chown`을 수행하도록 initContainer를 추가했다.

이 과정에서 initContainer 쪽 `volumeMount`가 `prometheus-db`라는 이름을 직접 참조하고 있었는데,
실제로 StatefulSet이 생성한 PVC 이름은 Helm 차트의 네이밍 규칙에 따라
`prometheus-kps-kube-...-db` 형태로 만들어지고 있었다.

존재하지 않는 볼륨을 마운트하려다 보니 파드는 생성 단계에서 바로 실패하고 있었다.

`values.yaml`에서 `volumeClaimTemplate`의 이름을 명시적으로 지정해
파드 스펙과 PVC 이름을 맞췄다.

```yaml
prometheus:
  prometheusSpec:
    storageSpec:
      volumeClaimTemplate:
        metadata:
          name: prometheus-db
        spec:
          accessModes: ["ReadWriteOnce"]
          storageClassName: cinder-hdd
          resources:
            requests:
              storage: 50Gi
```

이 설정을 적용한 뒤 Prometheus 파드는 정상적으로 생성되기 시작했다.

## 파드는 생성됐지만 Ready 상태가 되지 않았다

파드는 올라왔지만 Ready 상태로 전환되지 않았고,
Service 엔드포인트 역시 여전히 비어 있었다.

컨테이너 로그를 확인해보니
Prometheus가 데이터 디렉터리에 접근하지 못하는 권한 오류가 발생하고 있었다.

initContainer에서 `chown`을 수행하고 있었지만,
스토리지 타입과 CSI 드라이버의 동작 방식에 따라
권한 변경이 기대한 대로 적용되지 않거나,
재마운트 시 다시 원래 권한으로 돌아가는 상황이 반복됐다.

## initContainer를 제거한 이유

조금 더 찾아보니, 공식 문서와 운영 사례에서도
initContainer로 권한을 우회하기보다는
`fsGroup`을 통해 Kubernetes가 볼륨 마운트 시점에
권한을 일관되게 관리하도록 하는 방식을 권장하고 있었다.

initContainer는 일회성 작업에 가깝고,
파드 재시작이나 재스케줄링 이후의 상태까지 보장하지는 않는다.
결국 권한 문제를 근본적으로 해결하기에는 적합하지 않았다.

그래서 initContainer를 제거하고,
스토리지와 보안 컨텍스트 설정을 정리하는 방향으로 접근을 바꿨다.

## StorageClass와 fsGroup을 통한 정리

먼저 파일 시스템 타입을 명시한 StorageClass를 새로 정의했다.
CSI 드라이버가 파일 시스템 권한을 제어할 수 있도록 `ext4`를 명시했다.

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: cinder-hdd-ext4
provisioner: cinder.csi.openstack.org
parameters:
  type: General HDD
  csi.storage.k8s.io/fstype: ext4
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
```

그리고 Prometheus 컨테이너에 `fsGroup`을 설정해
볼륨 마운트 시 디렉터리 소유권이 해당 그룹으로 조정되도록 했다.

```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 2000
  fsGroup: 2000
  fsGroupChangePolicy: OnRootMismatch
```

이후 Prometheus 파드는 정상적으로 Ready 상태로 전환됐고,
Service 엔드포인트도 생성되었다.
Ingress를 통해 접근했을 때 `503` 에러 역시 더 이상 발생하지 않았다.