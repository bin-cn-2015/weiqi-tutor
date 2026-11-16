# Weiqi Tutor

围棋启蒙模型：输入一道简单死活题，理解局面与题目要求，判断正解/错解，并用初学者能听懂的语言解释变化过程。

## 已实现的基础层

- SGF 解析与嵌套变化分支提取；分支标签缺失或冲突时保留为 unknown。
- 围棋规则核心：连通块、气、提子、自杀禁入、劫点和重复局面检查。
- 逐手回放并记录合法性、提子、气数、相邻棋块、打吃和真眼等棋理事实。
- 监督样本生成：来源标签与规则校验分离，冲突样本隔离。

## 从原题库导入入门题

项目复用 [weiqi-bot](https://github.com/zhangbin2025/weiqi-bot) 公开的死活题库，不把压缩题库复制进本仓库。导入器会读取题库索引，按标签选题，只下载命中的分块，并核对每个分块的 SGF 数量和稳定 ID。

```bash
npm install
npm run typecheck
npm run build

# 默认导入 15K 死活题
npm run import:library

# 限制先导入 100 道，便于快速检查
npm run import:library -- --difficulty 15K --type 死活 --limit 100

# 对导入题库进行规则验证并生成 JSONL 监督数据
npm run build:dataset -- ./data/raw/15K ./data/processed/15K.jsonl
npm run audit:sgf -- ./data/raw/15K
npm run build:explanations -- ./data/processed/15K.jsonl ./data/processed/15K-explanations.jsonl
npm run split:dataset -- ./data/processed/15K-explanations.jsonl ./data/processed/split 10
```

可用参数：`--difficulty 15K`、`--type 死活`、`--limit N`、`--output DIR`、`--concurrency 1..8`。设 `--difficulty all` 可忽略难度筛选。

## 从棋理事实生成解释监督样本

`build:explanations` 将已通过规则校验的明确正解/失败变化，转换为带有提子、打吃、连接、气数和眼位事实的中文解释样本。它只生成局部棋理解释，不会把局部特征误当成整道题的胜负结论。

## 训练数据格式

解释样本已经转换为通用的三轮 `messages` 对话格式，可供后续 SFT/LoRA 训练。输入包含棋盘尺寸、先手、初始摆子、题库题型/难度、SGF 根节点说明，以及规则引擎验证过的逐手棋理事实；目标包含正解/错解标签和对应的初学者解释。

训练/验证集按稳定题目 ID 分组切分，同一道题的不同变化线不会同时出现在训练集和验证集，避免数据泄漏。GitHub Actions 会自动构建数据并上传短期数据集 artifact。

## 初始模型训练

已加入基于 [Qwen3-0.6B](https://huggingface.co/Qwen/Qwen3-0.6B) 的 LoRA 微调脚本，模型权重采用 Apache-2.0 许可。它是首个小模型基线，不代表已经训练完成；训练需要 CUDA GPU。

```bash
pip install -r training/requirements.txt
python training/finetune_lora.py --train data/processed/split/train.jsonl --validation data/processed/split/validation.jsonl --output-dir artifacts/weiqi-tutor-qwen3-0.6b-lora
```

详细说明见 [`training/README.md`](training/README.md)。

## 数据质量约束

- 只把 SGF 中明确标注的正解/失败分支视为监督标签。
- 变化图、未知标签不强行转成正误。
- 标注为正解但规则回放非法的分支隔离。
- 数据导入报告会保存题库日期、标签分布、稳定 ID 和分块清单。

## 设计原则

**规则负责判定，模型负责理解与表达。** 当前仓库仍处于数据与棋理层建设阶段，尚未声称已经训练出可用模型。
