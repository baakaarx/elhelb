#!/usr/bin/env python3
"""
ELHELB PRIVATE AI — سكريبت التدريب العميق المخصص (4-bit QLoRA Fine-Tuning)
==========================================================================
يدرّب موديل مفتوح المصدر قوي في اللغة العربية (Qwen2.5-7B-Instruct)
على بيانات شركة الهلب المصدَّرة من مصنع التدريب (elhelb_finetune_sharegpt.jsonl)
ثم يصدر الموديل النهائي بصيغة GGUF لتشغيله محلياً بالكامل على Ollama بدون إنترنت!

التشغيل:
  pip install -r requirements.txt
  python3 train_lora.py --dataset ./elhelb_finetune_sharegpt.jsonl --epochs 3
"""

import argparse
import os
from datasets import load_dataset
import torch
from trl import SFTTrainer
from transformers import TrainingArguments
from unsloth import FastLanguageModel, is_bfloat16_supported
from unsloth.chat_templates import get_chat_template, standardize_sharegpt


def parse_args():
    parser = argparse.ArgumentParser(description="تدريب موديل مجموعة الهلب الخاص بـ QLoRA")
    parser.add_argument(
        "--base-model",
        type=str,
        default="unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
        help="الموديل الأساسي مفتوح المصدر (يدعم العربية بطلاقة)",
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default="./elhelb_finetune_sharegpt.jsonl",
        help="مسار ملف بيانات التدريب JSONL المصدّر من لوحة التحكم",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="./elhelb-qwen-lora",
        help="مجلد حفظ الأوزان المدربة ونسخة GGUF",
    )
    parser.add_argument("--epochs", type=int, default=3, help="عدد دورات التدريب")
    parser.add_argument("--max-seq-length", type=int, default=4096, help="طول السياق الأقصى")
    parser.add_argument(
        "--export-gguf",
        action="store_true",
        default=True,
        help="تصدير الموديل بصيغة GGUF (q4_k_m) لتشغيله في Ollama",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    if not os.path.exists(args.dataset):
        raise FileNotFoundError(
            f"لم يتم العثور على ملف التدريب: {args.dataset}\n"
            "قم بتحميل الملف أولاً من تبويب «مصنع تدريب الموديل» في واجهة ELHELB Private AI."
        )

    print(f"🚀 تحميل الموديل الأساسي بضغط 4-bit: {args.base_model}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base_model,
        max_seq_length=args.max_seq_length,
        dtype=None,
        load_in_4bit=True,
    )

    print("🧠 إضافة طبقات التخصيص الخفيفة (LoRA Adapters)...")
    model = FastLanguageModel.get_peft_model(
        model,
        r=16,
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        lora_alpha=16,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=3407,
    )

    tokenizer = get_chat_template(tokenizer, chat_template="qwen-2.5")

    print(f"📚 قراءة وتجهيز بيانات الشركة من: {args.dataset}")
    dataset = load_dataset("json", data_files=args.dataset, split="train")
    dataset = standardize_sharegpt(dataset)

    def formatting_prompts_func(examples):
        convos = examples["conversations"]
        texts = [
            tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False)
            for convo in convos
        ]
        return {"text": texts}

    dataset = dataset.map(formatting_prompts_func, batched=True)

    print("⚙️ بدء التدريب المحلي الآمن...")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_length,
        dataset_num_proc=2,
        packing=False,
        args=TrainingArguments(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            num_train_epochs=args.epochs,
            learning_rate=2e-4,
            fp16=not is_bfloat16_supported(),
            bf16=is_bfloat16_supported(),
            logging_steps=1,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="linear",
            seed=3407,
            output_dir=args.output_dir,
            report_to="none",  # منع إرسال أي إحصائيات تدريب لخدمات خارجية مثل WandB!
        ),
    )

    trainer.train()

    print(f"✅ حفظ أوزان LoRA في {args.output_dir}/lora_adapter")
    model.save_pretrained(os.path.join(args.output_dir, "lora_adapter"))
    tokenizer.save_pretrained(os.path.join(args.output_dir, "lora_adapter"))

    if args.export_gguf:
        gguf_dir = os.path.join(args.output_dir, "gguf")
        print(f"📦 تحويل الموديل إلى صيغة GGUF (q4_k_m) جاهز لـ Ollama في: {gguf_dir}")
        model.save_pretrained_gguf(gguf_dir, tokenizer, quantization_method="q4_k_m")
        print("\n🎉 تم الانتهاء بنجاح! لتشغيل الموديل في Ollama نفّذ:")
        print("   ollama create elhelb-gpt-v1 -f Modelfile")


if __name__ == "__main__":
    main()
