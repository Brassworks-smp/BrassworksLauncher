use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AccountKind {
    Offline,
    Microsoft,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub uuid: String,
    #[serde(flatten)]
    pub kind: AccountKind,
}

impl Account {
    pub fn offline(username: impl Into<String>) -> Self {
        let username = username.into();
        let uuid = offline_uuid(&username);
        Self {
            id: uuid.clone(),
            username,
            uuid,
            kind: AccountKind::Offline,
        }
    }

    pub fn microsoft(uuid: impl Into<String>, username: impl Into<String>) -> Self {
        let uuid = uuid.into();
        Self {
            id: uuid.clone(),
            username: username.into(),
            uuid,
            kind: AccountKind::Microsoft,
        }
    }

    pub fn is_microsoft(&self) -> bool {
        self.kind == AccountKind::Microsoft
    }

    pub(crate) fn normalize(&mut self) {
        if self.uuid.is_empty() && self.kind == AccountKind::Offline {
            self.uuid = offline_uuid(&self.username);
            if self.id.is_empty() {
                self.id = self.uuid.clone();
            }
        }
    }
}

pub fn offline_uuid(username: &str) -> String {
    let digest = md5::compute(format!("OfflinePlayer:{username}"));
    uuid::Builder::from_bytes(digest.0)
        .with_variant(uuid::Variant::RFC4122)
        .with_version(uuid::Version::Md5)
        .into_uuid()
        .to_string()
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AccountStatus {
        Ok,
        NeedsRelogin,
        Offline,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountStore {
    pub accounts: Vec<Account>,
    pub selected: Option<String>,
}

impl AccountStore {
    pub fn active(&self) -> Option<&Account> {
        match &self.selected {
            Some(id) => self
                .accounts
                .iter()
                .find(|a| &a.id == id)
                .or_else(|| self.accounts.first()),
            None => self.accounts.first(),
        }
    }

    pub fn upsert(&mut self, account: Account) {
        if let Some(existing) = self.accounts.iter_mut().find(|a| a.id == account.id) {
            *existing = account.clone();
        } else {
            self.accounts.push(account.clone());
        }
        self.selected = Some(account.id);
    }

    pub fn remove(&mut self, id: &str) {
        self.accounts.retain(|a| a.id != id);
        if self.selected.as_deref() == Some(id) {
            self.selected = self.accounts.first().map(|a| a.id.clone());
        }
    }
}
