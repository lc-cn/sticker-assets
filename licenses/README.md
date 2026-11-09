# licenses/

每个 `<licenseId>.json` 是一条**公开**的许可/授权说明（schema：`schemas/v1/license.schema.json`）。

- `kind=self-created`：项目维护者自制。
- `kind=license`：公开许可（必须有 `spdx` 与公开 `url`），例如 CC-BY-4.0。
- `kind=creator-permission`：权利人公开声明授权（必须有公开 `url`）。

**私密授权截图、聊天记录、联系方式等证据不进本仓库**，只在维护者本地私密保存；资产的 `rights.basis=pending` 不得进入本仓库。
“审核过权利依据”不等于机器证明绝对合法；发现问题走下架（tombstone）流程。
本仓库的代码（lib/ scripts/ test/）与图片素材分别适用各自许可；图片以各资产 `rights.licenseId` 指向的记录为准。
