from pydantic import BaseModel


class InterviewStartResponse(BaseModel):
    session_id: str
    opening_message: str


class InterviewMessageRequest(BaseModel):
    session_id: str
    message: str


class InterviewEndRequest(BaseModel):
    session_id: str


class AnalysisStatusResponse(BaseModel):
    status: str
