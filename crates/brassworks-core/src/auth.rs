use serde::{Deserialize, Serialize};

pub const AZURE_APP_ID: &str = "708e91b5-99f8-4a1d-80ec-e746cbb24771";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MicrosoftCode {
    pub user_code: String,
    pub verification_uri: String,
    pub message: String,
}
