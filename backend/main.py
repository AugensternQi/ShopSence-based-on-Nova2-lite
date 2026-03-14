import os

import boto3
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="ShopSense AI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProductRequest(BaseModel):
    title: str
    price: str
    reviews: str


def build_prompt(payload: ProductRequest) -> str:
    return (
        "You are an expert shopping assistant.\n"
        "Analyze the product below and provide a concise response with:\n"
        "- Pros\n"
        "- Cons\n"
        "- Brief verdict\n\n"
        f"Title: {payload.title}\n"
        f"Price: {payload.price}\n"
        f"Reviews: {payload.reviews}\n"
    )


@app.post("/api/analyze")
def analyze_product(payload: ProductRequest) -> dict[str, str]:
    client = boto3.client(
        "bedrock-runtime",
        region_name=os.getenv("AWS_REGION"),
    )
    prompt_string = build_prompt(payload)

    try:
        response = client.converse(
            modelId="global.amazon.nova-2-lite-v1:0",
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt_string}],
                }
            ],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Bedrock request failed: {exc}") from exc

    try:
        output_text = response["output"]["message"]["content"][0]["text"]
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Unexpected Bedrock response format: {exc}"
        ) from exc

    return {"result": output_text}
