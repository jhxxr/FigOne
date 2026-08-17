use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rfd::{AsyncFileDialog, MessageButtons, MessageDialog, MessageLevel};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use zip::ZipArchive;

#[cfg(target_os = "windows")]
use std::ptr::null_mut;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::OpenProcess;
#[cfg(target_os = "windows")]
const PROCESS_SET_QUOTA: u32 = 0x0100;
#[cfg(target_os = "windows")]
const PROCESS_TERMINATE: u32 = 0x0001;
#[cfg(target_os = "windows")]
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x2000;

const MODEL_FILENAME: &str = "sam3.pt";
const MODEL_METADATA_FILENAME: &str = "sam3.json";
const PROVIDER_PROFILES_FILENAME: &str = "provider-profiles.json";
const RMBG_DIRNAME: &str = "RMBG-2.0";
const RMBG_WEIGHT_FILENAME: &str = "model.safetensors";
const RMBG_METADATA_FILENAME: &str = "rmbg2.json";
const RMBG_BUNDLE_DIRNAME: &str = "rmbg2-src";
const RMBG_REQUIRED_SIDECARS: &[&str] = &["config.json", "birefnet.py", "BiRefNet_config.py"];
const CPU_RUNTIME_ARCHIVE_FILENAME: &str = "python-runtime-cpu.zip";
const CPU_RUNTIME_MANIFEST_FILENAME: &str = "python-runtime-cpu.manifest.json";
const CPU_RUNTIME_CACHE_DIRNAME: &str = "python-cpu";
const CPU_RUNTIME_COMPLETE_MARKER: &str = ".complete";
const CPU_RUNTIME_REQUIRED_FILES: &[&str] = &[
    "python.exe",
    "Lib/site-packages/torch/__init__.py",
    "Lib/site-packages/torchvision/__init__.py",
    "Lib/site-packages/transformers/__init__.py",
    "Lib/site-packages/sam3/model_builder.py",
    "Lib/site-packages/sam3/assets/bpe_simple_vocab_16e6.txt.gz",
];
const MAX_CPU_RUNTIME_UNCOMPRESSED_BYTES: u64 = 8 * 1024 * 1024 * 1024;

struct EngineProcess(Mutex<Option<Child>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartupProgress {
    phase: String,
    current_bytes: u64,
    total_bytes: u64,
    message: String,
    error: Option<String>,
    ready: bool,
    #[serde(skip)]
    exit_requested: bool,
}

impl Default for StartupProgress {
    fn default() -> Self {
        Self {
            phase: "starting".to_string(),
            current_bytes: 0,
            total_bytes: 0,
            message: "正在准备 FigOne…".to_string(),
            error: None,
            ready: false,
            exit_requested: false,
        }
    }
}

struct StartupState(Mutex<StartupProgress>);

#[cfg(target_os = "windows")]
struct JobObjectHandle(HANDLE);

#[cfg(target_os = "windows")]
impl Drop for JobObjectHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
fn create_job_object_with_kill_on_close() -> Result<JobObjectHandle, String> {
    unsafe {
        let job = CreateJobObjectW(null_mut(), null_mut());
        if job.is_null() {
            return Err("Failed to create job object".to_string());
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let result = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );

        if result == 0 {
            CloseHandle(job);
            return Err("Failed to configure job object".to_string());
        }

        Ok(JobObjectHandle(job))
    }
}

#[cfg(target_os = "windows")]
fn assign_process_to_job(job: HANDLE, pid: u32) -> Result<(), String> {
    unsafe {
        let process_handle = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
        if process_handle.is_null() {
            return Err(format!("Failed to open process {}", pid));
        }

        let result = AssignProcessToJobObject(job, process_handle);
        CloseHandle(process_handle);

        if result == 0 {
            return Err(format!("Failed to assign process {} to job object", pid));
        }

        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelStatus {
    ready: bool,
    file_name: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    imported_at: Option<u64>,
    runtime: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RmbgModelStatus {
    ready: bool,
    file_name: Option<String>,
    size_bytes: Option<u64>,
    sha256: Option<String>,
    imported_at: Option<u64>,
    model_dir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelMetadata {
    file_name: String,
    size_bytes: u64,
    sha256: String,
    imported_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CpuRuntimeManifest {
    fingerprint: Option<String>,
    sha256: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelImportProgress {
    phase: &'static str,
    copied_bytes: u64,
    total_bytes: u64,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProfileStore {
    #[serde(default = "provider_profile_store_version")]
    version: u8,
    active_profile_id: Option<String>,
    #[serde(default)]
    profiles: Vec<StoredProviderProfile>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredProviderProfile {
    id: String,
    name: String,
    provider: String,
    svg_model: String,
    image_provider: Option<String>,
    image_model: Option<String>,
    base_url: Option<String>,
    image_base_url: Option<String>,
    api_key_protected: Option<String>,
    image_api_key_protected: Option<String>,
    updated_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProfileInput {
    id: Option<String>,
    name: String,
    provider: String,
    svg_model: String,
    image_provider: Option<String>,
    image_model: Option<String>,
    base_url: Option<String>,
    image_base_url: Option<String>,
    api_key: Option<String>,
    image_api_key: Option<String>,
    make_active: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProfile {
    id: String,
    name: String,
    provider: String,
    svg_model: String,
    image_provider: Option<String>,
    image_model: Option<String>,
    base_url: Option<String>,
    image_base_url: Option<String>,
    api_key: Option<String>,
    image_api_key: Option<String>,
    api_key_saved: bool,
    image_api_key_saved: bool,
    updated_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderProfiles {
    active_profile_id: Option<String>,
    profiles: Vec<ProviderProfile>,
}

fn provider_profile_store_version() -> u8 {
    1
}

fn find_free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .unwrap_or(18000)
}

fn is_development() -> bool {
    cfg!(debug_assertions)
}

fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if is_development() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(|path| path.join("engine"))
            .ok_or_else(|| "FigOne engine directory is unavailable".to_string());
    }

    app.path()
        .resource_dir()
        .map(|path| path.join("engine"))
        .map_err(|error| format!("无法定位 FigOne Engine 资源: {error}"))
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位 FigOne 数据目录: {error}"))
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("models"))
}

fn managed_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(MODEL_FILENAME))
}

fn model_metadata_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(MODEL_METADATA_FILENAME))
}

fn managed_rmbg_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(RMBG_DIRNAME))
}

fn managed_rmbg_weight_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(managed_rmbg_dir(app)?.join(RMBG_WEIGHT_FILENAME))
}

fn rmbg_metadata_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(RMBG_METADATA_FILENAME))
}

fn rmbg_bundle_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(engine_dir(app)?.join(RMBG_BUNDLE_DIRNAME))
}

fn rmbg_dir_is_ready(dir: &PathBuf) -> bool {
    if !dir.is_dir() {
        return false;
    }
    if !dir.join(RMBG_WEIGHT_FILENAME).is_file() {
        return false;
    }
    RMBG_REQUIRED_SIDECARS
        .iter()
        .all(|name| dir.join(name).is_file())
}

fn read_rmbg_metadata(app: &AppHandle) -> Option<ModelMetadata> {
    let path = rmbg_metadata_path(app).ok()?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn build_rmbg_model_status(app: &AppHandle) -> Result<RmbgModelStatus, String> {
    let dir = managed_rmbg_dir(app)?;
    if !rmbg_dir_is_ready(&dir) {
        return Ok(RmbgModelStatus {
            ready: false,
            file_name: None,
            size_bytes: None,
            sha256: None,
            imported_at: None,
            model_dir: None,
        });
    }
    let weight = managed_rmbg_weight_path(app)?;
    let size_bytes = fs::metadata(&weight)
        .map_err(|error| format!("无法读取 RMBG 权重信息: {error}"))?
        .len();
    let metadata = read_rmbg_metadata(app).filter(|metadata| {
        metadata.file_name == RMBG_WEIGHT_FILENAME && metadata.size_bytes == size_bytes
    });
    Ok(RmbgModelStatus {
        ready: true,
        file_name: Some(RMBG_WEIGHT_FILENAME.to_string()),
        size_bytes: Some(size_bytes),
        sha256: metadata.as_ref().map(|metadata| metadata.sha256.clone()),
        imported_at: metadata.map(|metadata| metadata.imported_at),
        model_dir: Some(dir.display().to_string()),
    })
}

fn resolved_rmbg_model_dir(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let dir = managed_rmbg_dir(app)?;
    if rmbg_dir_is_ready(&dir) {
        return Ok(Some(dir));
    }
    Ok(None)
}

fn provider_profiles_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(PROVIDER_PROFILES_FILENAME))
}

fn hf_home_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join("huggingface"))
}

fn read_provider_profile_store(app: &AppHandle) -> Result<ProviderProfileStore, String> {
    let path = provider_profiles_path(app)?;
    if !path.is_file() {
        return Ok(ProviderProfileStore {
            version: provider_profile_store_version(),
            ..Default::default()
        });
    }
    let text = fs::read_to_string(&path).map_err(|error| format!("无法读取提供商配置: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("提供商配置已损坏: {error}"))
}

fn write_provider_profile_store(
    app: &AppHandle,
    store: &ProviderProfileStore,
) -> Result<(), String> {
    let target = provider_profiles_path(app)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录: {error}"))?;
    }
    let temporary = target.with_extension("json.saving");
    let contents = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("无法序列化提供商配置: {error}"))?;
    fs::write(&temporary, contents).map_err(|error| format!("无法保存提供商配置: {error}"))?;
    if target.is_file() {
        fs::remove_file(&target).map_err(|error| format!("无法更新提供商配置: {error}"))?;
    }
    fs::rename(&temporary, &target).map_err(|error| format!("无法完成提供商配置保存: {error}"))
}

#[cfg(windows)]
fn protect_secret(value: &str) -> Result<String, String> {
    use std::ptr::null;
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if value.is_empty() {
        return Ok(String::new());
    }
    let bytes = value.as_bytes();
    let input = CRYPT_INTEGER_BLOB {
        cbData: bytes
            .len()
            .try_into()
            .map_err(|_| "API Key 太长，无法安全保存".to_string())?,
        pbData: bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptProtectData(
            &input,
            null(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!("Windows 无法加密 API Key（错误 {}）", unsafe {
            GetLastError()
        }));
    }
    let encrypted = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        BASE64.encode(slice)
    };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(encrypted)
}

#[cfg(windows)]
fn unprotect_secret(value: &str) -> Result<String, String> {
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if value.is_empty() {
        return Ok(String::new());
    }
    let encrypted = BASE64
        .decode(value)
        .map_err(|_| "已保存的 API Key 格式无效".to_string())?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted
            .len()
            .try_into()
            .map_err(|_| "已保存的 API Key 数据过大".to_string())?,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            null_mut(),
            null(),
            null(),
            null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(format!("Windows 无法解密 API Key（错误 {}）", unsafe {
            GetLastError()
        }));
    }
    let decrypted = unsafe {
        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        String::from_utf8(slice.to_vec())
            .map_err(|_| "已保存的 API Key 不是有效文本".to_string())?
    };
    unsafe {
        LocalFree(output.pbData.cast());
    }
    Ok(decrypted)
}

#[cfg(not(windows))]
fn protect_secret(value: &str) -> Result<String, String> {
    Ok(BASE64.encode(value.as_bytes()))
}

#[cfg(not(windows))]
fn unprotect_secret(value: &str) -> Result<String, String> {
    let bytes = BASE64
        .decode(value)
        .map_err(|_| "已保存的 API Key 格式无效".to_string())?;
    String::from_utf8(bytes).map_err(|_| "已保存的 API Key 不是有效文本".to_string())
}

fn expose_provider_profile(
    profile: StoredProviderProfile,
    include_secrets: bool,
) -> ProviderProfile {
    let api_key_saved = profile
        .api_key_protected
        .as_deref()
        .is_some_and(|value| !value.is_empty());
    let image_api_key_saved = profile
        .image_api_key_protected
        .as_deref()
        .is_some_and(|value| !value.is_empty());
    ProviderProfile {
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        svg_model: profile.svg_model,
        image_provider: profile.image_provider,
        image_model: profile.image_model,
        base_url: profile.base_url,
        image_base_url: profile.image_base_url,
        api_key: include_secrets
            .then(|| {
                profile
                    .api_key_protected
                    .as_deref()
                    .and_then(|value| unprotect_secret(value).ok())
            })
            .flatten(),
        image_api_key: include_secrets
            .then(|| {
                profile
                    .image_api_key_protected
                    .as_deref()
                    .and_then(|value| unprotect_secret(value).ok())
            })
            .flatten(),
        api_key_saved,
        image_api_key_saved,
        updated_at: profile.updated_at,
    }
}

fn exposed_provider_profiles(store: ProviderProfileStore) -> ProviderProfiles {
    let profiles = store
        .profiles
        .into_iter()
        .map(|profile| expose_provider_profile(profile, false))
        .collect();
    ProviderProfiles {
        active_profile_id: store.active_profile_id,
        profiles,
    }
}

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn validate_provider_profile(profile: &ProviderProfileInput) -> Result<(), String> {
    const PROVIDERS: [&str; 5] = [
        "bianxie",
        "gemini",
        "openai_response",
        "openrouter",
        "custom",
    ];
    const IMAGE_PROVIDERS: [&str; 6] = [
        "same",
        "openai",
        "bianxie",
        "gemini",
        "openrouter",
        "custom",
    ];
    if profile.name.trim().is_empty() {
        return Err("请填写配置名称".to_string());
    }
    if !PROVIDERS.contains(&profile.provider.as_str()) {
        return Err("不支持该提供商".to_string());
    }
    if profile.svg_model.trim().is_empty() {
        return Err("请为提供商绑定 SVG 模型".to_string());
    }
    let image_provider = profile.image_provider.as_deref().unwrap_or("same");
    if !IMAGE_PROVIDERS.contains(&image_provider) {
        return Err("不支持该图片提供商".to_string());
    }
    if profile.provider == "custom" && clean_optional(profile.base_url.clone()).is_none() {
        return Err("自定义提供商必须填写 API URL".to_string());
    }
    if image_provider == "custom" && clean_optional(profile.image_base_url.clone()).is_none() {
        return Err("自定义图片提供商必须填写 API URL".to_string());
    }
    Ok(())
}

fn development_checkpoint() -> Option<PathBuf> {
    std::env::var("SAM3_CHECKPOINT")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

fn resolved_model_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    if is_development() {
        if let Some(path) = development_checkpoint() {
            if path.is_file() {
                return Ok(Some(path));
            }
        }
    }

    let path = managed_model_path(app)?;
    Ok(path.is_file().then_some(path))
}

fn read_model_metadata(app: &AppHandle) -> Option<ModelMetadata> {
    let path = model_metadata_path(app).ok()?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn build_model_status(app: &AppHandle) -> Result<ModelStatus, String> {
    let Some(path) = resolved_model_path(app)? else {
        return Ok(ModelStatus {
            ready: false,
            file_name: None,
            size_bytes: None,
            sha256: None,
            imported_at: None,
            runtime: "CPU Float32",
        });
    };

    let size_bytes = fs::metadata(&path)
        .map_err(|error| format!("无法读取模型信息: {error}"))?
        .len();
    let managed_path = managed_model_path(app)?;
    let metadata = (path == managed_path)
        .then(|| read_model_metadata(app))
        .flatten()
        .filter(|metadata| {
            metadata.file_name == MODEL_FILENAME && metadata.size_bytes == size_bytes
        });

    Ok(ModelStatus {
        ready: true,
        file_name: Some(MODEL_FILENAME.to_string()),
        size_bytes: Some(size_bytes),
        sha256: metadata.as_ref().map(|metadata| metadata.sha256.clone()),
        imported_at: metadata.map(|metadata| metadata.imported_at),
        runtime: "CPU Float32",
    })
}

fn update_startup_progress(
    app: &AppHandle,
    phase: &str,
    current_bytes: u64,
    total_bytes: u64,
    message: impl Into<String>,
) {
    let progress = StartupProgress {
        phase: phase.to_string(),
        current_bytes,
        total_bytes,
        message: message.into(),
        error: None,
        ready: phase == "ready",
        exit_requested: false,
    };
    if let Some(state) = app.try_state::<StartupState>() {
        *state.0.lock().unwrap() = progress.clone();
    }
    let _ = app.emit("startup-progress", progress);
}

fn update_startup_error(app: &AppHandle, error: String) {
    let progress = StartupProgress {
        phase: "error".to_string(),
        current_bytes: 0,
        total_bytes: 0,
        message: "FigOne 无法完成启动".to_string(),
        error: Some(error),
        ready: false,
        exit_requested: false,
    };
    if let Some(state) = app.try_state::<StartupState>() {
        *state.0.lock().unwrap() = progress.clone();
    }
    let _ = app.emit("startup-progress", progress);
}

fn request_startup_exit(app: &AppHandle) {
    if let Some(state) = app.try_state::<StartupState>() {
        state.0.lock().unwrap().exit_requested = true;
    }
}

#[tauri::command]
fn startup_status(state: State<'_, StartupState>) -> StartupProgress {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn close_startup_window(app: AppHandle) {
    // Closing the frameless splash should abort bootstrap before the main window exists.
    request_startup_exit(&app);
    if let Some(startup) = app.get_webview_window("startup") {
        let _ = startup.close();
    }
    app.exit(0);
}

fn safe_cpu_runtime_zip_path(name: &str) -> Result<PathBuf, String> {
    let normalized = name.replace('\\', "/");
    let mut relative = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(value) => relative.push(value),
            Component::CurDir => {}
            Component::Prefix(_) | Component::RootDir | Component::ParentDir => {
                return Err(format!(
                    "CPU runtime archive contains an unsafe path: {name}"
                ));
            }
        }
    }
    if relative.as_os_str().is_empty() {
        return Err("CPU runtime archive contains an empty path".to_string());
    }
    Ok(relative)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("无法读取 runtime 压缩包: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 8 * 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("无法校验 runtime 压缩包: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn valid_runtime_fingerprint(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn read_cpu_runtime_manifest(path: &Path) -> Option<CpuRuntimeManifest> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn cpu_runtime_cache_key(
    archive: &Path,
    manifest: Option<&CpuRuntimeManifest>,
) -> Result<String, String> {
    if let Some(manifest) = manifest {
        let fingerprint = manifest
            .fingerprint
            .as_deref()
            .or(manifest.sha256.as_deref())
            .unwrap_or_default();
        if valid_runtime_fingerprint(fingerprint) {
            return Ok(fingerprint.to_string());
        }
    }

    let metadata = fs::metadata(archive)
        .map_err(|error| format!("无法读取 CPU runtime 压缩包信息: {error}"))?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    Ok(format!("archive-{}-{modified}", metadata.len()))
}

fn cpu_runtime_is_complete(root: &Path, fingerprint: &str) -> bool {
    if !root.join(CPU_RUNTIME_COMPLETE_MARKER).is_file() {
        return false;
    }
    let marker = fs::read_to_string(root.join(CPU_RUNTIME_COMPLETE_MARKER)).ok();
    if marker.as_deref().map(str::trim) != Some(fingerprint) {
        return false;
    }
    CPU_RUNTIME_REQUIRED_FILES
        .iter()
        .all(|relative| root.join(relative).is_file())
}

fn validate_cpu_runtime(root: &Path) -> Result<(), String> {
    let missing: Vec<&str> = CPU_RUNTIME_REQUIRED_FILES
        .iter()
        .copied()
        .filter(|relative| !root.join(relative).is_file())
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "CPU runtime 解压后缺少必要文件: {}",
            missing.join(", ")
        ))
    }
}

fn extract_cpu_runtime_archive_with_progress<F>(
    archive_path: &Path,
    destination: &Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, u64),
{
    let file = File::open(archive_path)
        .map_err(|error| format!("无法打开 CPU runtime 压缩包: {error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("CPU runtime 压缩包损坏: {error}"))?;

    // Calculate a byte-based denominator before writing anything so the splash can
    // show a useful percentage instead of appearing frozen on a large archive.
    let mut total_bytes = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取 CPU runtime 压缩包条目: {error}"))?;
        if !entry.is_dir() {
            total_bytes = total_bytes
                .checked_add(entry.size())
                .ok_or_else(|| "CPU runtime 压缩包大小溢出".to_string())?;
        }
    }
    if total_bytes > MAX_CPU_RUNTIME_UNCOMPRESSED_BYTES {
        return Err("CPU runtime 压缩包解压内容超过安全上限".to_string());
    }
    on_progress(0, total_bytes);

    let mut copied_bytes = 0_u64;
    let mut last_report = Instant::now();
    let mut buffer = vec![0_u8; 1024 * 1024];
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取 CPU runtime 压缩包条目: {error}"))?;
        let name = entry.name().to_string();
        let relative = safe_cpu_runtime_zip_path(&name)?;
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)
                .map_err(|error| format!("无法创建 runtime 目录 {target:?}: {error}"))?;
            continue;
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("无法创建 runtime 目录 {parent:?}: {error}"))?;
        }
        let mut output = File::create(&target)
            .map_err(|error| format!("无法写入 runtime 文件 {target:?}: {error}"))?;
        loop {
            let read = entry
                .read(&mut buffer)
                .map_err(|error| format!("无法解压 runtime 文件 {target:?}: {error}"))?;
            if read == 0 {
                break;
            }
            output
                .write_all(&buffer[..read])
                .map_err(|error| format!("无法写入 runtime 文件 {target:?}: {error}"))?;
            copied_bytes = copied_bytes
                .checked_add(read as u64)
                .ok_or_else(|| "CPU runtime 解压大小溢出".to_string())?;
            if copied_bytes > MAX_CPU_RUNTIME_UNCOMPRESSED_BYTES {
                return Err("CPU runtime 压缩包解压内容超过安全上限".to_string());
            }
            if last_report.elapsed() >= Duration::from_millis(100) {
                on_progress(copied_bytes, total_bytes);
                last_report = Instant::now();
            }
        }
    }
    on_progress(copied_bytes, total_bytes);
    if copied_bytes != total_bytes {
        return Err("CPU runtime 压缩包内容长度校验失败".to_string());
    }
    Ok(())
}

fn ensure_cpu_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    update_startup_progress(app, "checking", 0, 0, "正在检查 CPU 运行环境…");
    let resource_engine = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法定位 FigOne 资源目录: {error}"))?
        .join("engine");
    let archive_path = resource_engine.join(CPU_RUNTIME_ARCHIVE_FILENAME);

    // Keep a directory fallback for local/legacy installations. Official CPU bundles use the ZIP.
    if !archive_path.is_file() {
        let legacy = resource_engine.join("python");
        if legacy.join("python.exe").is_file() {
            update_startup_progress(app, "ready", 1, 1, "CPU 运行环境已准备好");
            return Ok(legacy);
        }
        return Err(format!(
            "内置 CPU Python runtime 缺失: {}",
            archive_path.display()
        ));
    }

    let manifest = read_cpu_runtime_manifest(&resource_engine.join(CPU_RUNTIME_MANIFEST_FILENAME));
    let fingerprint = cpu_runtime_cache_key(&archive_path, manifest.as_ref())?;
    let cache_parent = app_data_dir(app)?
        .join("runtime")
        .join(CPU_RUNTIME_CACHE_DIRNAME);
    fs::create_dir_all(&cache_parent)
        .map_err(|error| format!("无法创建 CPU runtime 缓存目录: {error}"))?;
    let target = cache_parent.join(&fingerprint);
    if cpu_runtime_is_complete(&target, &fingerprint) {
        update_startup_progress(app, "ready", 1, 1, "CPU 运行环境已准备好");
        return Ok(target);
    }

    // Hashing the large archive is intentionally done only before extraction. Cached
    // runtimes return above without rereading the archive on every application start.
    if let Some(expected) = manifest.as_ref().and_then(|value| value.sha256.as_deref()) {
        if valid_runtime_fingerprint(expected) {
            let archive_bytes = fs::metadata(&archive_path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
            update_startup_progress(app, "verifying", 0, archive_bytes, "正在校验 CPU 运行环境…");
            let actual = sha256_file(&archive_path)?;
            if !actual.eq_ignore_ascii_case(expected) {
                return Err("CPU runtime 压缩包校验失败，文件可能已损坏".to_string());
            }
        }
    }
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("无法清理不完整的 CPU runtime: {error}"))?;
    }

    let staging = cache_parent.join(format!(".{fingerprint}.{}.staging", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging)
            .map_err(|error| format!("无法清理 CPU runtime 临时目录: {error}"))?;
    }
    fs::create_dir_all(&staging)
        .map_err(|error| format!("无法创建 CPU runtime 临时目录: {error}"))?;

    update_startup_progress(app, "extracting", 0, 0, "首次启动正在准备运行环境…");
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    if let Err(error) = extract_cpu_runtime_archive_with_progress(
        &archive_path,
        &staging,
        |copied_bytes, total_bytes| {
            if last_progress.elapsed() >= Duration::from_millis(100) || copied_bytes == total_bytes
            {
                update_startup_progress(
                    app,
                    "extracting",
                    copied_bytes,
                    total_bytes,
                    "首次启动正在解压运行环境…",
                );
                last_progress = Instant::now();
            }
        },
    )
    .and_then(|_| {
        update_startup_progress(app, "finalizing", 1, 1, "正在完成运行环境准备…");
        validate_cpu_runtime(&staging)
    })
    .and_then(|_| {
        fs::write(staging.join(CPU_RUNTIME_COMPLETE_MARKER), &fingerprint)
            .map_err(|error| format!("无法写入 CPU runtime 完成标记: {error}"))
    }) {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    if let Err(error) = fs::rename(&staging, &target) {
        if target.exists() && cpu_runtime_is_complete(&target, &fingerprint) {
            let _ = fs::remove_dir_all(&staging);
            update_startup_progress(app, "ready", 1, 1, "CPU 运行环境已准备好");
            return Ok(target);
        }
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("无法启用 CPU runtime: {error}"));
    }

    update_startup_progress(app, "ready", 1, 1, "CPU 运行环境已准备好");
    Ok(target)
}

fn start_engine(app: &AppHandle, port: u16, python: &str) -> Result<(Child, PathBuf), String> {
    let dir = engine_dir(app)?;
    let runtime_dir = app_data_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir).map_err(|error| format!("无法创建运行目录: {error}"))?;
    let hf_home = hf_home_path(app)?;
    fs::create_dir_all(&hf_home)
        .map_err(|error| format!("无法创建 HuggingFace 缓存目录: {error}"))?;
    let log_path = runtime_dir.join("engine-startup.log");
    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("无法创建引擎日志: {error}"))?;
    writeln!(
        log_file,
        "\n--- FigOne Engine startup on 127.0.0.1:{port} ---"
    )
    .map_err(|error| format!("无法写入引擎日志: {error}"))?;
    let stderr = log_file
        .try_clone()
        .map_err(|error| format!("无法准备引擎日志: {error}"))?;

    let mut command = Command::new(python);
    command
        .arg("server.py")
        .current_dir(&dir)
        .env("FIGONE_HOST", "127.0.0.1")
        .env("FIGRA_HOST", "127.0.0.1")
        .env("FIGONE_PORT", port.to_string())
        .env("FIGRA_PORT", port.to_string())
        .env("AUTOFIGURE_PYTHON", python)
        .env("FIGONE_RUNTIME_DIR", &runtime_dir)
        .env("FIGRA_RUNTIME_DIR", &runtime_dir)
        .env("FIGONE_FORCE_CPU", if is_development() { "0" } else { "1" })
        .env("FIGRA_FORCE_CPU", if is_development() { "0" } else { "1" })
        .env("KMP_DUPLICATE_LIB_OK", "TRUE")
        .env("PYTHONUNBUFFERED", "1")
        .env("HF_HOME", &hf_home)
        .env("HUGGINGFACE_HUB_CACHE", hf_home.join("hub"))
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(stderr));

    if is_development() {
        // Dev builds keep using the local SAM3 source tree. Release builds install
        // sam3 into the bundled interpreter's site-packages instead.
        let mut python_path = dir.join("sam3-src").display().to_string();
        if let Ok(existing) = std::env::var("PYTHONPATH") {
            if !existing.is_empty() {
                python_path = format!("{python_path};{existing}");
            }
        }
        command.env("PYTHONPATH", python_path);
    } else {
        // The bundled interpreter must use its own stdlib/site-packages, not a stale
        // developer PYTHONPATH or PYTHONHOME inherited from the desktop process.
        command.env_remove("PYTHONPATH");
        command.env_remove("PYTHONHOME");
    }

    if let Some(model_path) = resolved_model_path(app)? {
        command.env("SAM3_CHECKPOINT", model_path);
    }
    if let Some(rmbg_dir) = resolved_rmbg_model_dir(app)? {
        command.env("FIGONE_RMBG_MODEL_PATH", &rmbg_dir);
        command.env("FIGRA_RMBG_MODEL_PATH", rmbg_dir);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map(|child| (child, log_path))
        .map_err(|error| format!("无法启动 FigOne Engine: {error}"))
}

fn engine_is_ready(port: u16) -> bool {
    let address = format!("127.0.0.1:{port}");
    let Ok(address) = address.parse() else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request =
        format!("GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    stream.read_to_string(&mut response).is_ok()
        && response.starts_with("HTTP/1.1 200")
        && (response.contains("\"service\":\"figone-engine\"")
            || response.contains("\"service\":\"figra-engine\""))
}

fn wait_for_engine(child: &mut Child, port: u16) -> Result<(), String> {
    for _ in 0..120 {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查引擎状态: {error}"))?
        {
            return Err(format!("FigOne Engine 提前退出: {status}"));
        }
        if engine_is_ready(port) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("FigOne Engine 未能在端口 {port} 上就绪"))
}

fn launch_engine(app: &AppHandle) -> Result<(Child, u16, PathBuf), String> {
    let python = if is_development() {
        std::env::var("AUTOFIGURE_PYTHON").unwrap_or_else(|_| "python".to_string())
    } else {
        log::info!("Preparing bundled CPU Python runtime");
        let root = ensure_cpu_runtime(app)?;
        log::info!("Bundled CPU Python runtime ready at {}", root.display());
        root.join("python.exe").display().to_string()
    };
    update_startup_progress(app, "starting-engine", 1, 1, "正在启动本地引擎…");
    let mut last_failure: Option<String> = None;
    let mut last_log_path = app_data_dir(app)?
        .join("runtime")
        .join("engine-startup.log");

    #[cfg(target_os = "windows")]
    let job = create_job_object_with_kill_on_close()?;

    for attempt in 1..=3 {
        let port = find_free_port();
        log::info!("Starting FigOne Engine attempt {attempt} on port {port}");
        let (mut child, log_path) = match start_engine(app, port, &python) {
            Ok(result) => result,
            Err(error) => {
                log::error!("FigOne Engine attempt {attempt} could not start: {error}");
                last_failure = Some(error);
                continue;
            }
        };
        last_log_path = log_path;

        #[cfg(target_os = "windows")]
        if let Err(error) = assign_process_to_job(job.0, child.id()) {
            log::error!("Failed to assign engine process to job object: {error}");
            last_failure = Some(error);
            let _ = child.kill();
            let _ = child.wait();
            continue;
        }

        match wait_for_engine(&mut child, port) {
            Ok(()) => {
                update_startup_progress(app, "ready", 1, 1, "FigOne 已准备好");
                log::info!("FigOne Engine is ready on port {port}, pid {}", child.id());
                #[cfg(target_os = "windows")]
                std::mem::forget(job);
                return Ok((child, port, last_log_path));
            }
            Err(error) => {
                log::error!("FigOne Engine attempt {attempt} failed: {error}");
                last_failure = Some(error);
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    let failure = last_failure.unwrap_or_else(|| "FigOne Engine 启动失败".to_string());
    Err(format!("{failure}\n日志: {}", last_log_path.display()))
}

#[tauri::command]
fn model_status(app: AppHandle) -> Result<ModelStatus, String> {
    build_model_status(&app)
}

#[tauri::command]
async fn import_sam3_model(app: AppHandle) -> Result<ModelStatus, String> {
    let Some(source) = AsyncFileDialog::new()
        .add_filter("SAM3 checkpoint", &["pt"])
        .set_title("选择 SAM3 模型文件 (sam3.pt)")
        .pick_file()
        .await
    else {
        return Err("已取消选择模型文件".to_string());
    };
    let source = source.path().to_owned();

    tauri::async_runtime::spawn_blocking(move || {
        let extension = source.extension().and_then(|value| value.to_str());
        if !matches!(extension, Some(value) if value.eq_ignore_ascii_case("pt")) {
            return Err("请选择 .pt 格式的 SAM3 模型文件".to_string());
        }

        let total_bytes = fs::metadata(&source)
            .map_err(|error| format!("无法读取模型文件信息: {error}"))?
            .len();
        if total_bytes == 0 {
            return Err("模型文件为空".to_string());
        }

        let target_dir = model_dir(&app)?;
        fs::create_dir_all(&target_dir).map_err(|error| format!("无法创建模型目录: {error}"))?;
        let target = managed_model_path(&app)?;
        let temporary = target.with_extension("pt.importing");
        let _ = fs::remove_file(&temporary);

        let source_file =
            File::open(&source).map_err(|error| format!("无法打开模型文件: {error}"))?;
        let mut reader = BufReader::new(source_file);
        let mut writer =
            File::create(&temporary).map_err(|error| format!("无法创建导入文件: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 8 * 1024 * 1024];
        let mut copied_bytes = 0_u64;

        let emit_progress = |phase, copied_bytes| {
            let _ = app.emit(
                "model-import-progress",
                ModelImportProgress {
                    phase,
                    copied_bytes,
                    total_bytes,
                },
            );
        };
        emit_progress("copying", 0);

        let copy_result: Result<(), String> = (|| {
            loop {
                let read = reader
                    .read(&mut buffer)
                    .map_err(|error| format!("读取模型文件失败: {error}"))?;
                if read == 0 {
                    break;
                }
                writer
                    .write_all(&buffer[..read])
                    .map_err(|error| format!("写入模型文件失败: {error}"))?;
                hasher.update(&buffer[..read]);
                copied_bytes += read as u64;
                emit_progress("copying", copied_bytes);
            }
            writer
                .flush()
                .map_err(|error| format!("刷新模型文件失败: {error}"))?;
            Ok(())
        })();

        if let Err(error) = copy_result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }

        let sha256 = format!("{:x}", hasher.finalize());
        emit_progress("finalizing", copied_bytes);
        let backup = target.with_extension("pt.backup");
        let _ = fs::remove_file(&backup);
        let had_existing_model = target.is_file();
        if had_existing_model {
            fs::rename(&target, &backup).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("无法准备替换已有模型: {error}")
            })?;
        }
        if let Err(error) = fs::rename(&temporary, &target) {
            if had_existing_model {
                let _ = fs::rename(&backup, &target);
            }
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法完成模型导入: {error}"));
        }
        if had_existing_model {
            let _ = fs::remove_file(&backup);
        }

        let imported_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("无法记录导入时间: {error}"))?
            .as_secs();
        let metadata = serde_json::json!({
            "fileName": MODEL_FILENAME,
            "sizeBytes": copied_bytes,
            "sha256": sha256,
            "importedAt": imported_at,
        });
        fs::write(
            model_metadata_path(&app)?,
            serde_json::to_vec_pretty(&metadata)
                .map_err(|error| format!("无法保存模型信息: {error}"))?,
        )
        .map_err(|error| format!("无法保存模型信息: {error}"))?;

        emit_progress("complete", copied_bytes);
        build_model_status(&app)
    })
    .await
    .map_err(|error| format!("模型导入任务异常结束: {error}"))?
}

#[tauri::command]
fn remove_sam3_model(app: AppHandle) -> Result<ModelStatus, String> {
    if is_development() && development_checkpoint().is_some() {
        return Err("开发模式正在使用 SAM3_CHECKPOINT，不能从应用中移除该外部模型。".to_string());
    }

    let target = managed_model_path(&app)?;
    if target.is_file() {
        fs::remove_file(target).map_err(|error| format!("无法移除模型: {error}"))?;
    }
    let metadata = model_metadata_path(&app)?;
    if metadata.is_file() {
        fs::remove_file(metadata).map_err(|error| format!("无法移除模型信息: {error}"))?;
    }
    build_model_status(&app)
}

#[tauri::command]
fn rmbg_model_status(app: AppHandle) -> Result<RmbgModelStatus, String> {
    build_rmbg_model_status(&app)
}

#[tauri::command]
async fn import_rmbg_weights(app: AppHandle) -> Result<RmbgModelStatus, String> {
    let Some(source) = AsyncFileDialog::new()
        .add_filter("RMBG weights", &["safetensors"])
        .set_title("选择 RMBG-2.0 权重 (model.safetensors)")
        .pick_file()
        .await
    else {
        return Err("已取消选择权重文件".to_string());
    };
    let source = source.path().to_owned();

    tauri::async_runtime::spawn_blocking(move || {
        let extension = source.extension().and_then(|value| value.to_str());
        if !matches!(extension, Some(value) if value.eq_ignore_ascii_case("safetensors")) {
            return Err("请选择 model.safetensors 权重文件".to_string());
        }

        let file_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if !file_name.eq_ignore_ascii_case(RMBG_WEIGHT_FILENAME)
            && !file_name.to_ascii_lowercase().ends_with(".safetensors")
        {
            return Err("请选择 .safetensors 格式的 RMBG 权重文件".to_string());
        }

        let total_bytes = fs::metadata(&source)
            .map_err(|error| format!("无法读取权重文件信息: {error}"))?
            .len();
        if total_bytes == 0 {
            return Err("权重文件为空".to_string());
        }
        // RMBG-2.0 weights are ~885MB; reject obviously wrong tiny files.
        if total_bytes < 100 * 1024 * 1024 {
            return Err(format!(
                "权重文件过小（{} 字节）。请下载完整的 model.safetensors（约 885 MB）。",
                total_bytes
            ));
        }

        let bundle = rmbg_bundle_dir(&app)?;
        if !bundle.is_dir() {
            return Err(format!(
                "未找到内置 RMBG 配置包：{}。请重新安装 FigOne。",
                bundle.display()
            ));
        }
        for name in RMBG_REQUIRED_SIDECARS {
            if !bundle.join(name).is_file() {
                return Err(format!("内置 RMBG 配置包缺少 {name}。请重新安装 FigOne。"));
            }
        }

        let target_dir = managed_rmbg_dir(&app)?;
        fs::create_dir_all(&target_dir)
            .map_err(|error| format!("无法创建 RMBG 模型目录: {error}"))?;

        // Refresh architecture sidecars from the bundled package.
        for name in RMBG_REQUIRED_SIDECARS {
            fs::copy(bundle.join(name), target_dir.join(name))
                .map_err(|error| format!("无法复制内置文件 {name}: {error}"))?;
        }
        // Optional extras if present in the bundle.
        for name in [
            "preprocessor_config.json",
            "FIGONE_NOTE.txt",
            "FIGRA_NOTE.txt",
        ] {
            let src = bundle.join(name);
            if src.is_file() {
                let _ = fs::copy(src, target_dir.join(name));
            }
        }

        let target = managed_rmbg_weight_path(&app)?;
        let temporary = target.with_extension("safetensors.importing");
        let _ = fs::remove_file(&temporary);

        let source_file =
            File::open(&source).map_err(|error| format!("无法打开权重文件: {error}"))?;
        let mut reader = BufReader::new(source_file);
        let mut writer =
            File::create(&temporary).map_err(|error| format!("无法创建导入文件: {error}"))?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 8 * 1024 * 1024];
        let mut copied_bytes = 0_u64;

        let emit_progress = |phase, copied_bytes| {
            let _ = app.emit(
                "rmbg-import-progress",
                ModelImportProgress {
                    phase,
                    copied_bytes,
                    total_bytes,
                },
            );
        };
        emit_progress("copying", 0);

        let copy_result: Result<(), String> = (|| {
            loop {
                let read = reader
                    .read(&mut buffer)
                    .map_err(|error| format!("读取权重文件失败: {error}"))?;
                if read == 0 {
                    break;
                }
                writer
                    .write_all(&buffer[..read])
                    .map_err(|error| format!("写入权重文件失败: {error}"))?;
                hasher.update(&buffer[..read]);
                copied_bytes += read as u64;
                emit_progress("copying", copied_bytes);
            }
            writer
                .flush()
                .map_err(|error| format!("刷新权重文件失败: {error}"))?;
            Ok(())
        })();

        if let Err(error) = copy_result {
            let _ = fs::remove_file(&temporary);
            return Err(error);
        }

        let sha256 = format!("{:x}", hasher.finalize());
        emit_progress("finalizing", copied_bytes);
        let backup = target.with_extension("safetensors.backup");
        let _ = fs::remove_file(&backup);
        let had_existing = target.is_file();
        if had_existing {
            fs::rename(&target, &backup).map_err(|error| {
                let _ = fs::remove_file(&temporary);
                format!("无法准备替换已有权重: {error}")
            })?;
        }
        if let Err(error) = fs::rename(&temporary, &target) {
            if had_existing {
                let _ = fs::rename(&backup, &target);
            }
            let _ = fs::remove_file(&temporary);
            return Err(format!("无法完成权重导入: {error}"));
        }
        if had_existing {
            let _ = fs::remove_file(&backup);
        }

        let imported_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("无法记录导入时间: {error}"))?
            .as_secs();
        let metadata = serde_json::json!({
            "fileName": RMBG_WEIGHT_FILENAME,
            "sizeBytes": copied_bytes,
            "sha256": sha256,
            "importedAt": imported_at,
        });
        fs::write(
            rmbg_metadata_path(&app)?,
            serde_json::to_vec_pretty(&metadata)
                .map_err(|error| format!("无法保存 RMBG 模型信息: {error}"))?,
        )
        .map_err(|error| format!("无法保存 RMBG 模型信息: {error}"))?;

        emit_progress("complete", copied_bytes);
        build_rmbg_model_status(&app)
    })
    .await
    .map_err(|error| format!("RMBG 导入任务异常结束: {error}"))?
}

#[tauri::command]
fn remove_rmbg_model(app: AppHandle) -> Result<RmbgModelStatus, String> {
    let target_dir = managed_rmbg_dir(&app)?;
    if target_dir.is_dir() {
        fs::remove_dir_all(&target_dir).map_err(|error| format!("无法移除 RMBG 模型: {error}"))?;
    }
    let metadata = rmbg_metadata_path(&app)?;
    if metadata.is_file() {
        fs::remove_file(metadata).map_err(|error| format!("无法移除 RMBG 模型信息: {error}"))?;
    }
    build_rmbg_model_status(&app)
}

#[tauri::command]
fn list_provider_profiles(app: AppHandle) -> Result<ProviderProfiles, String> {
    read_provider_profile_store(&app).map(exposed_provider_profiles)
}

#[tauri::command]
fn active_provider_profile(app: AppHandle) -> Result<Option<ProviderProfile>, String> {
    let store = read_provider_profile_store(&app)?;
    let Some(active_id) = store.active_profile_id else {
        return Ok(None);
    };
    Ok(store
        .profiles
        .into_iter()
        .find(|profile| profile.id == active_id)
        .map(|profile| expose_provider_profile(profile, true)))
}

#[tauri::command]
fn save_provider_profile(
    app: AppHandle,
    profile: ProviderProfileInput,
) -> Result<ProviderProfiles, String> {
    validate_provider_profile(&profile)?;
    let mut store = read_provider_profile_store(&app)?;
    let now_duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("无法记录配置时间: {error}"))?;
    let now = now_duration.as_secs();
    let id = profile
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!(
                "provider-{}-{}",
                now_duration.as_millis(),
                std::process::id()
            )
        });
    let existing = store.profiles.iter().find(|item| item.id == id).cloned();
    let api_key = clean_optional(profile.api_key);
    let image_api_key = clean_optional(profile.image_api_key);
    let stored = StoredProviderProfile {
        id: id.clone(),
        name: profile.name.trim().to_string(),
        provider: profile.provider,
        svg_model: profile.svg_model.trim().to_string(),
        image_provider: clean_optional(profile.image_provider).or_else(|| Some("same".to_string())),
        image_model: clean_optional(profile.image_model),
        base_url: clean_optional(profile.base_url),
        image_base_url: clean_optional(profile.image_base_url),
        api_key_protected: match api_key {
            Some(value) => Some(protect_secret(&value)?),
            None => existing
                .as_ref()
                .and_then(|item| item.api_key_protected.clone()),
        },
        image_api_key_protected: match image_api_key {
            Some(value) => Some(protect_secret(&value)?),
            None => existing
                .as_ref()
                .and_then(|item| item.image_api_key_protected.clone()),
        },
        updated_at: now,
    };
    if let Some(index) = store.profiles.iter().position(|item| item.id == id) {
        store.profiles[index] = stored;
    } else {
        store.profiles.push(stored);
    }
    if profile.make_active.unwrap_or(true) || store.active_profile_id.is_none() {
        store.active_profile_id = Some(id);
    }
    write_provider_profile_store(&app, &store)?;
    Ok(exposed_provider_profiles(store))
}

#[tauri::command]
fn activate_provider_profile(app: AppHandle, id: String) -> Result<ProviderProfiles, String> {
    let mut store = read_provider_profile_store(&app)?;
    if !store.profiles.iter().any(|profile| profile.id == id) {
        return Err("找不到该提供商配置".to_string());
    }
    store.active_profile_id = Some(id);
    write_provider_profile_store(&app, &store)?;
    Ok(exposed_provider_profiles(store))
}

#[tauri::command]
fn delete_provider_profile(app: AppHandle, id: String) -> Result<ProviderProfiles, String> {
    let mut store = read_provider_profile_store(&app)?;
    let previous_len = store.profiles.len();
    store.profiles.retain(|profile| profile.id != id);
    if store.profiles.len() == previous_len {
        return Err("找不到该提供商配置".to_string());
    }
    if store.active_profile_id.as_deref() == Some(id.as_str()) {
        store.active_profile_id = store.profiles.first().map(|profile| profile.id.clone());
    }
    write_provider_profile_store(&app, &store)?;
    Ok(exposed_provider_profiles(store))
}

fn create_main_window(
    app: &AppHandle,
    mut engine: Child,
    port: u16,
    log_path: PathBuf,
) -> Result<(), String> {
    // Load the shell from the local app origin so Tauri does not treat the UI as
    // remote content. Without an app ACL permissions directory, local app commands
    // stay unrestricted and new invoke handlers do not need ACL allowlist updates.
    let engine_origin = format!("http://127.0.0.1:{port}");
    let init_script = format!(
        r#"(function () {{
  var origin = {engine_origin};
  try {{
    Object.defineProperty(window, "__FIGONE_ENGINE_ORIGIN__", {{
      value: origin,
      writable: false,
      configurable: false,
      enumerable: false
    }});
    Object.defineProperty(window, "__FIGRA_ENGINE_ORIGIN__", {{
      value: origin,
      writable: false,
      configurable: false,
      enumerable: false
    }});
  }} catch (_) {{
    window.__FIGONE_ENGINE_ORIGIN__ = origin;
    window.__FIGRA_ENGINE_ORIGIN__ = origin;
  }}
}})();"#,
        engine_origin = serde_json::to_string(&engine_origin)
            .unwrap_or_else(|_| format!("\"http://127.0.0.1:{port}\""))
    );
    log::info!(
        "Creating main window from local app assets; engine API at {engine_origin}/; engine log: {}",
        log_path.display()
    );
    if let Err(error) = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("FigOne")
        .inner_size(800.0, 600.0)
        .resizable(true)
        .fullscreen(false)
        .initialization_script(init_script)
        .build()
    {
        let _ = engine.kill();
        let _ = engine.wait();
        return Err(format!("无法创建 FigOne 主窗口: {error}"));
    }

    *app.state::<EngineProcess>().0.lock().unwrap() = Some(engine);
    update_startup_progress(app, "ready", 1, 1, "FigOne 已准备好");
    if let Some(startup) = app.get_webview_window("startup") {
        let _ = startup.close();
    }
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EngineProcess(Mutex::new(None)))
        .manage(StartupState(Mutex::new(StartupProgress::default())))
        .invoke_handler(tauri::generate_handler![
            startup_status,
            close_startup_window,
            model_status,
            import_sam3_model,
            remove_sam3_model,
            rmbg_model_status,
            import_rmbg_weights,
            remove_rmbg_model,
            list_provider_profiles,
            active_provider_profile,
            save_provider_profile,
            activate_provider_profile,
            delete_provider_profile
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Show a real window before preparing the bundled runtime. The old startup
            // path did all of this synchronously inside setup, leaving users with no
            // feedback while ~1.5 GB / 24k files were extracted on the first launch.
            // Frameless splash keeps the Claude-like parchment UI free of native chrome.
            // Windows still gets a soft system shadow / rounded outline via shadow(true).
            WebviewWindowBuilder::new(app, "startup", WebviewUrl::App("startup.html".into()))
                .title("FigOne")
                .inner_size(560.0, 380.0)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .closable(true)
                .decorations(false)
                .shadow(true)
                .center()
                .build()?;

            let worker_app = app.handle().clone();
            thread::spawn(move || match launch_engine(&worker_app) {
                Ok((engine, port, log_path)) => {
                    let ui_app = worker_app.clone();
                    if let Err(error) = worker_app.run_on_main_thread(move || {
                        if let Err(error) = create_main_window(&ui_app, engine, port, log_path) {
                            log::error!("FigOne main window creation failed: {error}");
                            update_startup_error(&ui_app, error.clone());
                            MessageDialog::new()
                                .set_level(MessageLevel::Error)
                                .set_title("FigOne 启动失败")
                                .set_description(error)
                                .set_buttons(MessageButtons::Ok)
                                .show();
                            request_startup_exit(&ui_app);
                            ui_app.exit(1);
                        }
                    }) {
                        log::error!("Could not dispatch FigOne main window creation: {error}");
                        update_startup_error(&worker_app, error.to_string());
                        request_startup_exit(&worker_app);
                        worker_app.exit(1);
                    }
                }
                Err(error) => {
                    log::error!("FigOne Engine startup failed: {error}");
                    update_startup_error(&worker_app, error.clone());
                    let ui_app = worker_app.clone();
                    if let Err(dispatch_error) = worker_app.run_on_main_thread(move || {
                        MessageDialog::new()
                            .set_level(MessageLevel::Error)
                            .set_title("FigOne 启动失败")
                            .set_description(format!(
                                "本地 FigOne 引擎无法启动。\n\n{error}\n\n请重启应用；若问题持续，请提供该日志文件。"
                            ))
                            .set_buttons(MessageButtons::Ok)
                            .show();
                        request_startup_exit(&ui_app);
                        ui_app.exit(1);
                    }) {
                        log::error!("Could not show FigOne startup error: {dispatch_error}");
                        request_startup_exit(&worker_app);
                        worker_app.exit(1);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::CloseRequested { .. }) {
                return;
            }
            if window.label() == "startup" {
                let should_force_exit = window
                    .try_state::<StartupState>()
                    .map(|state| {
                        let progress = state.0.lock().unwrap();
                        !progress.ready && !progress.exit_requested
                    })
                    .unwrap_or(false);
                if should_force_exit {
                    // No engine child is exposed until startup completes. Exiting here
                    // prevents a closing splash from leaving the worker thread behind.
                    std::process::exit(0);
                }
                return;
            }
            if let Some(state) = window.try_state::<EngineProcess>() {
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running FigOne desktop application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_runtime_zip_paths_are_confined() {
        assert!(safe_cpu_runtime_zip_path("Lib/site-packages/torch/__init__.py").is_ok());
        assert!(safe_cpu_runtime_zip_path("./python.exe").is_ok());
        assert!(safe_cpu_runtime_zip_path("../outside.txt").is_err());
        assert!(safe_cpu_runtime_zip_path("C:/outside.txt").is_err());
        assert!(safe_cpu_runtime_zip_path("\\\\server\\share\\outside.txt").is_err());
    }

    #[test]
    fn cpu_runtime_archive_extracts_and_validates() {
        let root =
            std::env::temp_dir().join(format!("figone-cpu-runtime-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create test directory");
        let archive_path = root.join("runtime.zip");
        let destination = root.join("extracted");

        {
            let file = File::create(&archive_path).expect("create test archive");
            let mut writer = zip::ZipWriter::new(file);
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            for relative in CPU_RUNTIME_REQUIRED_FILES {
                writer
                    .start_file(relative, options)
                    .expect("create runtime entry");
                writer.write_all(b"test").expect("write runtime entry");
            }
            writer.finish().expect("finish test archive");
        }

        extract_cpu_runtime_archive_with_progress(&archive_path, &destination, |_, _| {})
            .expect("extract test archive");
        validate_cpu_runtime(&destination).expect("validate extracted runtime");
        fs::remove_dir_all(&root).expect("remove test directory");
    }

    #[test]
    fn cpu_runtime_fingerprints_are_safe_cache_names() {
        assert!(valid_runtime_fingerprint("a1b2-c3_d4"));
        assert!(!valid_runtime_fingerprint("../runtime"));
        assert!(!valid_runtime_fingerprint(""));
    }
}
