(() => {
  const INPUT_STATE_KEY = "autofigure_input_state_v2";
  const IMPORT_STATE_KEY = "autofigure_import_state_v1";
  const PROVIDER_PROFILE_FALLBACK_KEY = "figone_provider_profiles_v1";
  const LEGACY_PROVIDER_PROFILE_FALLBACK_KEY = "figra_provider_profiles_v1";
  const LOCALE_KEY = "autofigure_locale_v1";
  const BIANXIE_BASE_URL = "https://api.bianxie.ai/v1";
  const DEFAULT_CUSTOM_BASE_URL = "";
  const CUSTOM_BASE_URL_PLACEHOLDER = "https://your-provider.example/v1";
  const LEGACY_CUSTOM_BASE_URLS = new Set([BIANXIE_BASE_URL]);
  const ENGINE_ORIGIN = (() => {
    const rawInjected = typeof window.__FIGONE_ENGINE_ORIGIN__ === "string"
      ? window.__FIGONE_ENGINE_ORIGIN__
      : typeof window.__FIGRA_ENGINE_ORIGIN__ === "string"
      ? window.__FIGRA_ENGINE_ORIGIN__
      : "";
    const injected = rawInjected.trim().replace(/\/+$/, "");
    if (injected) return injected;
    // Standalone engine (browser on the FastAPI port) keeps same-origin paths.
    if (/^(127\.0\.0\.1|localhost)$/i.test(window.location.hostname || "")) {
      return "";
    }
    return "";
  })();

  const MULTIMODAL_IMAGE_SCALE_VALUES = ["1", "0.75", "0.5", "0.4", "0.25"];
  const DEFAULT_MULTIMODAL_IMAGE_SCALE = "0.5";

  function normalizeMultimodalImageScale(value) {
    const raw = value == null ? "" : String(value).trim();
    if (!raw) return DEFAULT_MULTIMODAL_IMAGE_SCALE;
    const asNumber = Number(raw);
    if (!Number.isFinite(asNumber)) return DEFAULT_MULTIMODAL_IMAGE_SCALE;
    for (const choice of MULTIMODAL_IMAGE_SCALE_VALUES) {
      if (Math.abs(asNumber - Number(choice)) < 1e-9) return choice;
    }
    return DEFAULT_MULTIMODAL_IMAGE_SCALE;
  }

  function fillMultimodalScaleOptions(selectEl, { shortLabels = false } = {}) {
    if (!selectEl) return;
    const current = normalizeMultimodalImageScale(selectEl.value || DEFAULT_MULTIMODAL_IMAGE_SCALE);
    const options = shortLabels
      ? [
          ["1", "Original 100%"],
          ["0.75", "High 75%"],
          ["0.5", "Balanced 50%"],
          ["0.4", "Compressed 40%"],
          ["0.25", "Small 25%"],
        ]
      : [
          ["1", t("input.multimodal_scale_original")],
          ["0.75", t("input.multimodal_scale_high")],
          ["0.5", t("input.multimodal_scale_balanced")],
          ["0.4", t("input.multimodal_scale_compressed")],
          ["0.25", t("input.multimodal_scale_small")],
        ];
    selectEl.replaceChildren();
    for (const [value, label] of options) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      selectEl.appendChild(option);
    }
    selectEl.value = current;
  }

  function engineUrl(path) {
    const raw = typeof path === "string" ? path : "";
    if (!raw) return ENGINE_ORIGIN || "/";
    if (/^(?:[a-z]+:)?\/\//i.test(raw) || raw.startsWith("data:") || raw.startsWith("blob:")) {
      return raw;
    }
    if (!ENGINE_ORIGIN) return raw;
    if (raw.startsWith("/")) return `${ENGINE_ORIGIN}${raw}`;
    return `${ENGINE_ORIGIN}/${raw}`;
  }

  function engineFetch(path, init) {
    return fetch(engineUrl(path), init);
  }

  let currentLocale = loadLocale();
  const localeListeners = [];
  document.documentElement.lang = currentLocale === "zh" ? "zh-CN" : "en";

  const I18N = {
    en: {
      providers: {
        gemini: "Gemini",
        bianxie: "Bianxie AI",
        openai_response: "OpenAI Responses",
        openrouter: "OpenRouter",
        custom: "Custom",
        openai_images: "OpenAI Images",
        same_as_svg: "Same as SVG path",
      },
      routeKinds: {
        responses: "Responses API",
        default: "default route",
      },
      upload: {
        only_images: "Only image files are supported.",
        uploading: "Uploading image...",
        uploaded_reference: "Using uploaded reference: {name}",
        uploaded_stage1: "Imported figure ready: {name}",
        upload_failed: "Upload failed",
        engine_unavailable: "The local FigOne engine is unavailable. Please restart the application.",
        reference_ready: "Reference image ready.",
        stage1_ready: "Imported stage-1 figure ready.",
        request_failed: "Request failed",
        failed_to_start: "Failed to start job",
      },
      input: {
        subtitle: "Generate SVG templates and preview every step.",
        import_entry: "I already have the stage-1 figure",
        guide_entry: "I don't know how to fill this",
        models_entry: "Models & Providers",
        method_label: "Method Text",
        method_placeholder: "Paste your paper method text here...",
        method_hint: "Tip: concise, structured method text yields cleaner templates.",
        pipeline_label: "Pipeline Routing",
        pipeline_caption: "Routes come from the selected provider profile.",
        route_step1: "Step 1 Raster",
        route_step4: "Step 4 SVG",
        profile_picker_label: "Provider Profile",
        profile_picker_caption: "Saved in Models & Providers. Switch here without re-entering keys.",
        profile_picker_empty_title: "No provider saved yet",
        profile_picker_empty_copy:
          "Add a provider once in Models & Providers, then come back to run the workflow.",
        profile_picker_empty_link: "Add provider",
        profile_picker_manage: "Manage",
        profile_meta_key_saved: "Key saved",
        profile_meta_key_missing: "Key missing",
        profile_meta_image: "Image: {provider} · {model}",
        bianxie_register_hint: 'Register at <a href="https://bianxieai.com/autofigure" target="_blank" rel="noopener noreferrer">bianxieai</a>.',
        custom_url_required: "Custom API URL required",
        optimize_label: "Optimize",
        multimodal_scale_label: "Multimodal preview quality",
        multimodal_scale_caption:
          "Only compresses images sent to the SVG model. Source files, SAM3, SVG canvas size, and final icons stay full resolution.",
        multimodal_scale_original: "Original (100%)",
        multimodal_scale_high: "High (75%)",
        multimodal_scale_balanced: "Balanced (50%, recommended)",
        multimodal_scale_compressed: "Compressed (40%)",
        multimodal_scale_small: "Small (25%)",
        image_size_label: "Image Size",
        upscale_label: "Auto Upscale",
        upscale_text: "Upscale figure.png to a 4K long edge while preserving aspect ratio",
        sam_backend_label: "SAM3 Backend",
        sam_prompt_label: "SAM Prompt",
        sam_api_key_label: "SAM3 API Key",
        sam_api_key_placeholder: "FAL/Roboflow API key",
        reference_image_label: "Reference Image",
        reference_upload_text: "Drop image here or click to upload",
        confirm_btn: "Confirm -> Canvas",
        starting: "Starting...",
        error_method_required: "Please provide method text.",
        error_profile_required: "Add a provider profile in Models & Providers first.",
        error_api_key_required:
          "This profile has no API key. Open Models & Providers and save a key first.",
        error_custom_base_url_required:
          "This profile is missing a Custom API URL. Edit it in Models & Providers.",
        error_custom_image_base_url_required:
          "This profile is missing an Image Provider API URL. Edit it in Models & Providers.",
        route_note_openai_linked:
          "Same as SVG path resolves step 1 to OpenAI Images, so one OpenAI-compatible key is usually enough.",
        route_note_override:
          "Step 1 overrides the SVG path in this profile. Image credentials can differ from the primary key.",
        route_note_linked:
          "Step 1 and step 4 stay linked through the selected provider profile. Switch profiles above or manage them in Models & Providers.",
      },
      importPage: {
        brand: "Import Stage-1 Figure",
        subtitle: "Skip step 1 generation and continue from an existing academic figure.",
        back: "Back to Method Workflow",
        models_entry: "Models & Providers",
        figure_label: "Stage-1 Figure",
        upload_text: "Drop the first-stage academic figure here or click to upload",
        figure_hint:
          "This image becomes <code>figure.png</code>. The pipeline will start from SAM segmentation and SVG reconstruction.",
        route_label: "Import Route",
        route_caption: "Only SAM and SVG stages remain in this workflow.",
        workflow_label: "Workflow",
        workflow_value: "Imported Figure -> SAM -> SVG",
        step1_label: "Step 1",
        step1_value: "Skipped",
        route_note:
          "The default 4K aspect-ratio-preserving preprocessing still applies after import.",
        profile_picker_label: "Provider Profile",
        profile_picker_caption: "Saved in Models & Providers. Switch here without re-entering keys.",
        profile_picker_empty_title: "No provider saved yet",
        profile_picker_empty_copy:
          "Add a provider once in Models & Providers, then come back to continue from this figure.",
        profile_picker_empty_link: "Add provider",
        profile_picker_manage: "Manage",
        bianxie_register_hint: 'Register at <a href="https://bianxieai.com/autofigure" target="_blank" rel="noopener noreferrer">bianxieai</a>.',
        multimodal_scale_label: "Multimodal preview quality",
        multimodal_scale_caption:
          "Only compresses images sent to the SVG model. Source files, SAM3, SVG canvas size, and final icons stay full resolution.",
        sam_backend_label: "SAM3 Backend",
        sam_prompt_label: "SAM Prompt",
        sam_api_key_label: "SAM3 API Key",
        sam_api_key_placeholder: "FAL/Roboflow API key",
        confirm_btn: "Continue From Uploaded Figure",
        starting: "Starting...",
        error_upload_required: "Please upload the stage-1 figure first.",
        error_profile_required: "Add a provider profile in Models & Providers first.",
        error_api_key_required:
          "This profile has no API key. Open Models & Providers and save a key first.",
        error_custom_base_url_required:
          "This profile is missing a Custom API URL. Edit it in Models & Providers.",
      },
      guide: {
        brand: "Configuration Guide",
        subtitle: "A practical guide for each field, each workflow, and recommended presets.",
        back_input: "AutoFigure-Edit",
        back_import: "I already have the stage-1 figure",
        overview_title: "Choose the Right Workflow",
        overview_copy:
          "Start from method text if you want the full pipeline. Start from import mode if you already have the stage-1 academic raster figure and only want SAM + SVG.",
        method_kicker: "Workflow A",
        method_title: "Method Text Workflow",
        method_copy:
          "Use the main page when you want AutoFigure-Edit to generate the first-stage image for you.",
        import_kicker: "Workflow B",
        import_title: "Import Existing Figure",
        import_copy:
          "Use the import page when you already have the academic raster figure and want to continue directly from segmentation and SVG reconstruction.",
        presets_title: "Recommended Presets",
        preset1_title: "Preset 1: OpenAI Main Route",
        preset1_copy:
          "SVG / Reasoning Provider: OpenAI Responses. Step 1 Image Provider: Same as SVG path. Image Model: gpt-image-2. SVG Model: gpt-5.5.",
        preset2_title: "Preset 2: Gemini + OpenAI Images",
        preset2_copy:
          "SVG / Reasoning Provider: Gemini. Step 1 Image Provider: OpenAI Images. Image Model: gpt-image-2. Use this if you prefer Gemini SVG reconstruction but OpenAI image generation.",
        preset3_title: "Preset 3: Custom Relay",
        preset3_copy:
          "Choose Bianxie AI for the built-in aggregate route, or choose Custom and fill Custom API URL when you use your own OpenAI-compatible relay.",
        pipeline_steps_title: "What the Pipeline Actually Does",
        step1_kicker: "Step 1",
        step1_title: "Generate or Import figure.png",
        step1_copy:
          "The system either generates the academic raster figure from method text, or accepts your uploaded stage-1 figure directly.",
        step2_kicker: "Step 2",
        step2_title: "Run SAM3 segmentation",
        step2_copy:
          "SAM3 detects icon-like regions and creates labeled placeholders plus box metadata.",
        step3_kicker: "Step 3",
        step3_title: "Crop icons and remove background",
        step3_copy:
          "Each detected icon is cropped and cleaned so later replacement in SVG becomes easier.",
        step4_kicker: "Step 4",
        step4_title: "Rebuild as SVG",
        step4_copy:
          "The multimodal model reconstructs the figure as editable SVG while respecting the placeholder layout from SAM.",
        step5_kicker: "Step 5",
        step5_title: "Replace placeholders and finalize",
        step5_copy:
          "Placeholder boxes are replaced by processed icons and the final SVG is written for editing or export.",
        main_steps_title: "Main Page: Step-by-Step Filling Guide",
        main_step1_title: "1. Paste method text",
        main_step1_copy:
          "Start with the method section, not the abstract. Include the pipeline logic, components, arrows, stages, and notable visual entities that should appear in the figure.",
        main_step2_title: "2. Choose SVG / Reasoning Provider",
        main_step2_copy:
          "This decides how SVG reconstruction works. If you do not want to think too much, use OpenAI Responses or Gemini first.",
        main_step3_title: "3. Decide whether step 1 should follow or override",
        main_step3_copy:
          "Keep Step 1 Image Provider linked unless you specifically want a different image model or a different service for the raster generation stage.",
        main_step4_title: "4. Fill API key and Custom URL only when needed",
        main_step4_copy:
          "For OpenAI Responses + linked OpenAI Images, one compatible API key is often enough. Fill Custom API URL only if you selected Custom on that route.",
        main_step5_title: "5. Tune image model, SVG model, and SAM settings",
        main_step5_copy:
          "Leave the defaults first, then only adjust model ids or SAM prompt/backend if you know what is failing or what visual style you need.",
        import_steps_title: "Import Page: Step-by-Step Filling Guide",
        import_step1_title: "1. Upload the stage-1 academic figure",
        import_step1_copy:
          "This should be the raster figure that normally would have been produced by step 1. Do not upload the reference image or a final SVG here.",
        import_step2_title: "2. Choose only the SVG / reasoning route",
        import_step2_copy:
          "Import mode skips image generation, so there is no step 1 image provider to fill. You only need to decide how SAM and SVG reconstruction should continue.",
        import_step3_title: "3. Fill SVG model and API key",
        import_step3_copy:
          "Use the default SVG model first. Change it only if you know your provider exposes a better model for multimodal SVG reconstruction.",
        import_step4_title: "4. Configure SAM backend",
        import_step4_copy:
          "SAM still runs in import mode. You must choose whether it uses local SAM3, fal.ai, or Roboflow, and provide the corresponding key if the backend requires one.",
        fields_title: "What Each Field Means",
        field_method_title: "Method Text",
        field_method_copy:
          "Paste the method section of your paper. The cleaner and more structural it is, the better the generated figure tends to be.",
        field_provider_title: "SVG / Reasoning Provider",
        field_provider_copy:
          "Controls the text reasoning and the multimodal SVG reconstruction stage. This is the most important provider selector on the page.",
        field_image_provider_title: "Step 1 Image Provider",
        field_image_provider_copy:
          "Controls only the first-stage raster image generation. Leave it linked if you do not need to separate the image path from the SVG path.",
        field_custom_url_title: "Custom API URL",
        field_custom_url_copy:
          "Used only when the route is Custom. Fill the OpenAI-compatible base URL provided by your relay or gateway.",
        field_image_model_title: "Image Model",
        field_image_model_copy:
          "Default is gpt-image-2 for OpenAI Images. You can manually replace it with any compatible image model id if needed.",
        field_svg_model_title: "SVG Model",
        field_svg_model_copy:
          "Default follows the selected reasoning route. The default for OpenAI Responses is gpt-5.5, while Gemini/OpenRouter/Custom use the Gemini defaults unless you know you need a different id.",
        field_upscale_title: "Auto Upscale",
        field_upscale_copy:
          "Enabled by default. It enlarges figure.png to a 4K long edge while preserving aspect ratio. Keep it on unless you specifically want the original resolution.",
        field_sam_title: "SAM Settings",
        field_sam_copy:
          "SAM Backend selects how segmentation runs. SAM Prompt controls what objects the model should try to detect, such as icons, people, robots, or animals.",
        sam_title: "SAM3 Backend Guide",
        sam_local_title: "Local (SAM3)",
        sam_local_copy:
          "Best when you already installed SAM3 locally and want everything on your own machine. No external API key is needed, but local dependencies must be ready.",
        sam_fal_title: "fal.ai API",
        sam_fal_copy:
          "Good if you do not want to install SAM3 locally and you have a FAL key. Usually stable, but it is an external paid API route.",
        sam_roboflow_title: "Roboflow API",
        sam_roboflow_copy:
          "Often the easiest hosted SAM option. Use this when you want a remote backend and your environment can reach the Roboflow endpoint.",
        sam_prompt_title: "How to Fill SAM Prompt",
        sam_prompt_copy:
          "Think of SAM Prompt as the object vocabulary. Use comma-separated words such as `icon,person,robot,animal` or add domain words like `diagram,cell,molecule,arrow`.",
        sam_when_title: "When to Change SAM Backend",
        sam_when_copy:
          "If local SAM3 is unavailable, switch to fal.ai or Roboflow. If remote APIs are slow or inaccessible, local becomes the fallback if your environment supports it.",
        sam_key_title: "When a SAM API Key Is Required",
        sam_key_copy:
          "Local does not need a SAM API key. fal.ai needs a FAL key. Roboflow needs a Roboflow key. If the SAM backend is local, leave the SAM API key blank.",
        examples_title: "Common Filling Examples",
        example1_title: "I only want the easiest stable setup",
        example1_copy:
          "Main page. Provider = OpenAI Responses. Image Provider = Same as SVG path. Image Model = gpt-image-2. SVG Model = gpt-5.5. Fill one API key.",
        example2_title: "I already have the stage-1 figure",
        example2_copy:
          "Import page. Upload the figure. Choose Provider = OpenAI Responses or Gemini. Fill SVG Model and API Key. Leave image settings alone because step 1 is skipped.",
        example3_title: "I use a relay / private API gateway",
        example3_copy:
          "Choose Custom on the route you want to redirect. Fill Custom API URL with your gateway base URL, then fill the matching API key.",
        help_badge: "Need more help?",
        help_title: "Still not sure?",
        help_copy:
          "Try consulting the project knowledge base for a more detailed explanation and up-to-date context.",
        help_button: "Open DeepWiki",
      },
      canvas: {
        brand: "FigOne Canvas",
        status_label: "Status:",
        waiting: "Waiting",
        running: "Running",
        done: "Done",
        failed: "Failed",
        disconnected: "Disconnected",
        back_config: "Back to Config",
        back_import: "Back to Import",
        back_history: "Back to History",
        history_ready: "Historical result loaded",
        history_not_found: "History job not found",
        image_preview_title: "Image preview",
        image_preview_body: "This historical run does not include a final SVG yet.",
        logs: "Logs",
        job: "Job",
        fallback_title: "SVG-Edit not installed",
        fallback_body:
          'Drop an SVG-Edit build into <code>web/vendor/svg-edit/</code> (editor/index.html) to enable editing.',
        editor_error_title: "SVG-Edit failed to start",
        artifacts: "Artifacts",
        missing_job: "Missing job id",
        resume: "Continue from checkpoint",
        resume_hint: "Retry from saved artifacts (skip finished steps)",
        resuming: "Resuming...",
        resume_need_profile: "Add a provider profile with API key before resuming.",
        resume_need_artifacts: "Need figure.png and samed.png before resume.",
        resume_failed: "Failed to resume job",
        svg_rerun_label: "SVG preview",
        svg_rerun_model_label: "SVG model",
        svg_rerun_model_title: "Multimodal model id used for SVG rebuild. Pick a preset or type any model id.",
        svg_rerun_btn: "Regenerate SVG",
        svg_rerun_hint:
          "Rebuild only the multimodal SVG step. You can change preview ratio and SVG model. SAM3 and icon matting are reused.",
        svg_rerunning: "Regenerating SVG...",
        svg_rerun_need_profile: "Add a provider profile with API key before regenerating SVG.",
        svg_rerun_need_artifacts: "Need figure.png, samed.png, and icons before regenerating SVG.",
        svg_rerun_failed: "Failed to regenerate SVG",
        svg_rerun_running: "Wait for the current job to finish before regenerating SVG.",
        steps: {
          figure: "Figure generated",
          samed: "SAM3 segmentation",
          icon_raw: "Icons extracted",
          icon_nobg: "Icons refined",
          template_svg: "Template SVG ready",
          optimized_template_svg: "Optimized template ready",
          final_svg: "Final SVG ready",
        },
        pipeline: {
          eyebrow: "PIPELINE EXECUTION",
          title: "Academic figure reconstruction pipeline",
          subtitle: "Running multi-stage detection, segmentation, and vector SVG rebuild",
          badge_running: "Running",
          badge_failed: "Failed",
          badge_done: "Completed",
          badge_history: "Historical",
          badge_disconnected: "Disconnected",
          view_logs: "View live detailed logs",
          enter_canvas: "Open canvas",
          waiting_log: "Waiting for engine log output...",
          topbar_ready: "0% · Ready",
          stage_history_ready: "Historical result loaded — not running",
          stage_start: "Step 1: Preparing academic raster figure...",
          stage_gen_figure: "Step 1: Generating academic figure...",
          stage_skip_figure: "Step 1 skipped, reusing existing figure",
          stage_sam: "Step 2: Running SAM3 segmentation...",
          stage_rmbg: "Step 3: Cropping icons and removing backgrounds...",
          stage_icons_ready: "Step 3: Icons ready, preparing multimodal SVG prompt...",
          stage_svg_build: "Step 4: Multimodal model reconstructing SVG structure...",
          stage_svg_optimize: "Step 4.6: Validating and optimizing SVG layout...",
          stage_svg_align: "Step 4.7: Aligning coordinate systems...",
          stage_template_ready: "Step 4: Template SVG ready, preparing final assembly...",
          stage_assemble: "Step 5: Aligning and embedding vector elements...",
          stage_all_done: "All done! Editable layered SVG is ready",
          stage_all_done_short: "All 5 pipeline stages completed successfully!",
          stage_failed: "Job interrupted (code {code})",
          step1_title: "Generate / Import",
          step1_desc: "figure.png",
          step2_title: "SAM segmentation",
          step2_desc: "samed.png",
          step3_title: "Icon matting",
          step3_desc: "RMBG-2.0 cutout",
          step4_title: "SVG rebuild",
          step4_desc: "template.svg",
          step5_title: "Final assembly",
          step5_desc: "final.svg canvas",
        },
      },
      history: {
        nav: "History",
        brand: "History",
        subtitle: "Saved AutoFigure-Edit outputs.",
        back_input: "Back to Method Workflow",
        back_import: "Back to Import Workflow",
        refresh: "Refresh",
        summary_title: "Saved Images",
        count: "{count} items",
        loading: "Loading...",
        empty_title: "No history yet",
        empty_body: "Saved outputs will appear here after a run writes files into outputs/.",
        open: "Open",
        delete: "Delete",
        delete_confirm: "Are you sure you want to delete this record ({job}) and all its artifacts?",
        delete_failed: "Delete failed",
        deleting: "Deleting...",
        complete: "Complete",
        partial: "Partial",
        artifacts: "{count} artifacts",
        updated: "Updated {time}",
        unknown_time: "Unknown time",
        provider_unknown: "Provider unknown",
        model_unknown: "Model unknown",
        scale_label: "Preview {scale}%",
        delete_title: "Delete this run?",
        delete_body: "This permanently removes {job} and all of its artifacts from disk.",
        delete_cancel: "Cancel",
        delete_confirm_btn: "Delete",
      },
    },
    zh: {
      providers: {
        gemini: "Gemini",
        bianxie: "便携AI",
        openai_response: "OpenAI Responses",
        openrouter: "OpenRouter",
        custom: "自定义",
        openai_images: "OpenAI 图像",
        same_as_svg: "与 SVG 路径一致",
      },
      routeKinds: {
        responses: "Responses API",
        default: "默认路由",
      },
      upload: {
        only_images: "仅支持图片文件。",
        uploading: "正在上传图片...",
        uploaded_reference: "参考图已上传：{name}",
        uploaded_stage1: "第一阶段图片已上传：{name}",
        upload_failed: "上传失败",
        engine_unavailable: "本地 FigOne 引擎不可用，请重启应用后重试。",
        reference_ready: "参考图已就绪。",
        stage1_ready: "导入的第一阶段图片已就绪。",
        request_failed: "请求失败",
        failed_to_start: "启动失败",
      },
      input: {
        subtitle: "生成 SVG 模板并预览每个步骤。",
        import_entry: "我已经有第一阶段的图片了",
        guide_entry: "我不知道怎么填",
        models_entry: "模型与提供商",
        method_label: "方法文本",
        method_placeholder: "请粘贴论文的方法部分文本...",
        method_hint: "提示：结构清晰、简洁的方法文本通常会得到更干净的模板。",
        pipeline_label: "流程路由",
        pipeline_caption: "路由由当前选中的提供商配置决定。",
        route_step1: "步骤 1 位图",
        route_step4: "步骤 4 SVG",
        profile_picker_label: "提供商配置",
        profile_picker_caption: "在「模型与提供商」中保存。这里切换，无需重新填写 Key。",
        profile_picker_empty_title: "还没有提供商配置",
        profile_picker_empty_copy: "先在「模型与提供商」添加一次，再回来运行工作流。",
        profile_picker_empty_link: "添加提供商",
        profile_picker_manage: "管理",
        profile_meta_key_saved: "Key 已保存",
        profile_meta_key_missing: "未保存 Key",
        profile_meta_image: "图片：{provider} · {model}",
        bianxie_register_hint: '注册链接：<a href="https://bianxieai.com/autofigure" target="_blank" rel="noopener noreferrer">bianxieai</a>。',
        custom_url_required: "需要填写自定义 API URL",
        optimize_label: "优化轮数",
        multimodal_scale_label: "多模态预览质量",
        multimodal_scale_caption:
          "只压缩发给 SVG 模型的图片。源文件、SAM3、SVG 画布尺寸和最终嵌入图标仍保持高清。",
        multimodal_scale_original: "原图（100%）",
        multimodal_scale_high: "高清（75%）",
        multimodal_scale_balanced: "均衡（50%，推荐）",
        multimodal_scale_compressed: "压缩（40%）",
        multimodal_scale_small: "更小（25%）",
        image_size_label: "图片尺寸",
        upscale_label: "自动放大",
        upscale_text: "将 figure.png 等比例放大到 4K 长边",
        sam_backend_label: "SAM3 后端",
        sam_prompt_label: "SAM Prompt",
        sam_api_key_label: "SAM3 API Key",
        sam_api_key_placeholder: "FAL/Roboflow API key",
        reference_image_label: "参考图片",
        reference_upload_text: "拖拽图片到这里，或点击上传",
        confirm_btn: "确认并进入画布",
        starting: "正在启动...",
        error_method_required: "请先填写方法文本。",
        error_profile_required: "请先在「模型与提供商」中添加提供商配置。",
        error_api_key_required: "当前配置没有 API Key。请先到「模型与提供商」保存 Key。",
        error_custom_base_url_required:
          "当前配置缺少自定义 API URL。请到「模型与提供商」编辑该配置。",
        error_custom_image_base_url_required:
          "当前配置缺少图片路线 API URL。请到「模型与提供商」编辑该配置。",
        route_note_openai_linked:
          "当与 SVG 路径一致且使用 OpenAI Responses 时，步骤 1 会自动落到 OpenAI Images，所以通常一套 OpenAI 兼容 Key 就够了。",
        route_note_override:
          "此配置中步骤 1 已脱离 SVG 路径独立设置。图片凭据可以与主 Key 不同。",
        route_note_linked:
          "步骤 1 和步骤 4 通过所选提供商配置保持联动。可在上方切换配置，或到「模型与提供商」管理。",
      },
      importPage: {
        brand: "导入第一阶段图片",
        subtitle: "跳过步骤 1 生图，直接从现成的学术图片继续。",
        back: "返回文本工作流",
        models_entry: "模型与提供商",
        figure_label: "第一阶段图片",
        upload_text: "把第一阶段学术图片拖到这里，或点击上传",
        figure_hint:
          "这张图片会成为 <code>figure.png</code>，后续流程将直接从 SAM 分割和 SVG 重建开始。",
        route_label: "导入路线",
        route_caption: "这个工作流只保留 SAM 和 SVG 阶段。",
        workflow_label: "流程",
        workflow_value: "导入图片 -> SAM -> SVG",
        step1_label: "步骤 1",
        step1_value: "已跳过",
        route_note: "导入后仍会默认执行 4K 等比例预处理。",
        profile_picker_label: "提供商配置",
        profile_picker_caption: "在「模型与提供商」中保存。这里切换，无需重新填写 Key。",
        profile_picker_empty_title: "还没有提供商配置",
        profile_picker_empty_copy: "先在「模型与提供商」添加一次，再回来从这张图继续。",
        profile_picker_empty_link: "添加提供商",
        profile_picker_manage: "管理",
        bianxie_register_hint: '注册链接：<a href="https://bianxieai.com/autofigure" target="_blank" rel="noopener noreferrer">bianxieai</a>。',
        multimodal_scale_label: "多模态预览质量",
        multimodal_scale_caption:
          "只压缩发给 SVG 模型的图片。源文件、SAM3、SVG 画布尺寸和最终嵌入图标仍保持高清。",
        sam_backend_label: "SAM3 后端",
        sam_prompt_label: "SAM Prompt",
        sam_api_key_label: "SAM3 API Key",
        sam_api_key_placeholder: "FAL/Roboflow API key",
        confirm_btn: "从已上传图片继续",
        starting: "正在启动...",
        error_upload_required: "请先上传第一阶段图片。",
        error_profile_required: "请先在「模型与提供商」中添加提供商配置。",
        error_api_key_required: "当前配置没有 API Key。请先到「模型与提供商」保存 Key。",
        error_custom_base_url_required:
          "当前配置缺少自定义 API URL。请到「模型与提供商」编辑该配置。",
      },
      guide: {
        brand: "配置指南",
        subtitle: "按字段、按工作流、按常见方案解释每一项该怎么填。",
        back_input: "AutoFigure-Edit",
        back_import: "我已经有第一阶段的图片了",
        overview_title: "先选对工作流",
        overview_copy:
          "如果你要跑完整流程，就从方法文本开始；如果你已经有第一阶段学术位图，就走导入模式，只做 SAM + SVG。",
        method_kicker: "工作流 A",
        method_title: "方法文本工作流",
        method_copy:
          "当你希望 AutoFigure-Edit 帮你自动生成第一阶段图片时，使用主页面。",
        import_kicker: "工作流 B",
        import_title: "导入已有图片",
        import_copy:
          "当你已经有学术位图，只想继续做分割和 SVG 重建时，使用导入页面。",
        presets_title: "推荐填写方案",
        preset1_title: "方案 1：OpenAI 主路线",
        preset1_copy:
          "SVG / 推理 Provider 选 OpenAI Responses，步骤 1 图片 Provider 保持与 SVG 路径一致，Image Model 用 gpt-image-2，SVG Model 用 gpt-5.5。",
        preset2_title: "方案 2：Gemini + OpenAI Images",
        preset2_copy:
          "SVG / 推理 Provider 选 Gemini，步骤 1 图片 Provider 改成 OpenAI Images，Image Model 用 gpt-image-2。适合你想保留 Gemini 的 SVG 重建，但生图想走 OpenAI。",
        preset3_title: "方案 3：自定义中转 / 网关",
        preset3_copy:
          "内置聚合路线可选择便携AI；如果你使用自己的 OpenAI 兼容中转或私有网关，则选择 Custom 并填写对应的 Custom API URL。",
        pipeline_steps_title: "完整流程 1 到 5 步在做什么",
        step1_kicker: "步骤 1",
        step1_title: "生成或导入 figure.png",
        step1_copy:
          "系统要么根据方法文本生成第一阶段学术位图，要么直接接收你上传的第一阶段图片。",
        step2_kicker: "步骤 2",
        step2_title: "运行 SAM3 分割",
        step2_copy:
          "SAM3 会检测图标类区域，并生成带标签的占位框和对应的 box 元数据。",
        step3_kicker: "步骤 3",
        step3_title: "裁切图标并去背景",
        step3_copy:
          "每个检测到的图标都会被裁切并清理背景，以便后续更容易放回 SVG。",
        step4_kicker: "步骤 4",
        step4_title: "重建为 SVG",
        step4_copy:
          "多模态模型会参考原图和 SAM 占位信息，把整张图重建成可编辑的 SVG。",
        step5_kicker: "步骤 5",
        step5_title: "替换占位符并输出最终结果",
        step5_copy:
          "系统会把占位框替换成处理后的图标，并写出最终 SVG 用于编辑或导出。",
        main_steps_title: "主页面怎么一步步填写",
        main_step1_title: "1. 先贴方法文本",
        main_step1_copy:
          "尽量贴方法部分而不是摘要。把流程逻辑、组件、箭头、阶段划分和关键视觉对象都写清楚。",
        main_step2_title: "2. 先选 SVG / 推理 Provider",
        main_step2_copy:
          "这一步决定 SVG 重建怎么跑。如果你不想想太多，先用 OpenAI Responses 或 Gemini。",
        main_step3_title: "3. 再决定步骤 1 是否跟随或单独覆盖",
        main_step3_copy:
          "如果你并不明确需要拆开生图路径和 SVG 路径，就让 Step 1 Image Provider 保持联动。",
        main_step4_title: "4. 只在需要时填写 API Key 和 Custom URL",
        main_step4_copy:
          "如果是 OpenAI Responses 且图片路线保持联动，通常一套兼容 Key 就够了。只有在选了 Custom 时才需要填写 Custom API URL。",
        main_step5_title: "5. 最后再改模型和 SAM 设置",
        main_step5_copy:
          "建议先保留默认值，只有在你明确知道当前失败点或目标风格时，再去改模型 id、SAM Prompt 或 SAM Backend。",
        import_steps_title: "导入页面怎么一步步填写",
        import_step1_title: "1. 上传第一阶段学术图片",
        import_step1_copy:
          "这里上传的应该是本来会由步骤 1 生成的位图，不要上传参考图，也不要上传最终 SVG。",
        import_step2_title: "2. 只选 SVG / 推理路线",
        import_step2_copy:
          "导入模式已经跳过生图，所以不需要再填写步骤 1 的图片路线。你只需要决定后续 SVG 重建怎么跑。",
        import_step3_title: "3. 填 SVG 模型和 API Key",
        import_step3_copy:
          "先用默认 SVG 模型即可。只有当你明确知道当前 provider 暴露了更适合的多模态模型时，再手动改。",
        import_step4_title: "4. 配置 SAM 后端",
        import_step4_copy:
          "导入模式仍然需要 SAM。你要明确它是走本地 SAM3、fal.ai，还是 Roboflow，并根据后端填写对应 Key。",
        fields_title: "每个字段是什么意思",
        field_method_title: "方法文本",
        field_method_copy:
          "粘贴论文的方法部分。结构越清晰、越贴近真实论文方法，生成出的图通常越稳定。",
        field_provider_title: "SVG / 推理 Provider",
        field_provider_copy:
          "控制文本推理和多模态 SVG 重建阶段。这是页面里最重要的 provider 选择器。",
        field_image_provider_title: "步骤 1 图片 Provider",
        field_image_provider_copy:
          "只控制第一阶段的位图生成。如果你不需要把生图路径和 SVG 路径拆开，保持联动即可。",
        field_custom_url_title: "Custom API URL",
        field_custom_url_copy:
          "只有在路线选择为 Custom 时才需要填写。这里填你的中转、网关或兼容 OpenAI 的 base URL。",
        field_image_model_title: "图片模型",
        field_image_model_copy:
          "OpenAI Images 默认推荐 gpt-image-2。如果你知道自己要换别的图片模型，也可以直接手填模型 id。",
        field_svg_model_title: "SVG 模型",
        field_svg_model_copy:
          "默认会跟随当前推理路线。OpenAI Responses 默认是 gpt-5.5；Gemini/OpenRouter/Custom 默认沿用 Gemini 系列模型，除非你明确知道要改。",
        field_upscale_title: "自动放大",
        field_upscale_copy:
          "默认开启，会把 figure.png 等比例放大到 4K 长边。除非你明确要保留原分辨率，否则建议保持开启。",
        field_sam_title: "SAM 设置",
        field_sam_copy:
          "SAM Backend 决定分割怎么跑；SAM Prompt 决定模型优先检测哪些对象，例如图标、人物、机器人、动物。",
        sam_title: "SAM3 后端说明",
        sam_local_title: "Local (SAM3)",
        sam_local_copy:
          "适合你已经在本地装好了 SAM3，并希望整个流程都在自己的机器上跑。它不需要外部 API key，但本地依赖必须准备好。",
        sam_fal_title: "fal.ai API",
        sam_fal_copy:
          "适合你不想本地安装 SAM3，但手里有 FAL key 的情况。通常比较稳，但它是外部付费 API 路线。",
        sam_roboflow_title: "Roboflow API",
        sam_roboflow_copy:
          "通常是托管 SAM 里最容易上手的一条路。如果你想用远端分割，且环境能访问 Roboflow，就可以优先尝试它。",
        sam_prompt_title: "SAM Prompt 怎么填",
        sam_prompt_copy:
          "可以把 SAM Prompt 理解成“对象词表”。常见写法是逗号分隔的词，比如 `icon,person,robot,animal`，也可以根据领域加上 `diagram,cell,molecule,arrow` 这类词。",
        sam_when_title: "什么时候要切换 SAM Backend",
        sam_when_copy:
          "如果本地 SAM3 不可用，就切到 fal.ai 或 Roboflow；如果远端 API 连不上或太慢，而你的环境支持本地 SAM3，那本地就是回退方案。",
        sam_key_title: "什么时候需要 SAM API Key",
        sam_key_copy:
          "Local 不需要 SAM API key；fal.ai 需要 FAL key；Roboflow 需要 Roboflow key。如果你选的是 local，就把 SAM API key 留空。",
        examples_title: "常见填写示例",
        example1_title: "我只想要最稳最省事的配置",
        example1_copy:
          "主页面。Provider 选 OpenAI Responses，Image Provider 保持与 SVG 路径一致，Image Model 用 gpt-image-2，SVG Model 用 gpt-5.5，只填一套 API Key。",
        example2_title: "我已经有第一阶段图片了",
        example2_copy:
          "导入页面。上传图片后，Provider 选 OpenAI Responses 或 Gemini，填写 SVG Model 和 API Key 即可。图片相关设置不用再管，因为步骤 1 已经跳过。",
        example3_title: "我在用中转 / 私有 API 网关",
        example3_copy:
          "在你想重定向的路线里选择 Custom，然后把 Custom API URL 改成你的网关地址，再填写对应的 API Key。",
        help_badge: "还需要帮助？",
        help_title: "仍然不会？",
        help_copy:
          "请尝试前往项目知识库查看更多说明与最新上下文，里面会有更完整的解释和补充材料。",
        help_button: "点击前往 DeepWiki 咨询",
      },
      canvas: {
        brand: "FigOne 画布",
        status_label: "状态：",
        waiting: "等待中",
        running: "运行中",
        done: "完成",
        failed: "失败",
        disconnected: "连接断开",
        back_config: "返回配置页",
        back_import: "返回导入页",
        back_history: "返回历史图片",
        history_ready: "已加载历史结果",
        history_not_found: "未找到历史任务",
        image_preview_title: "图片预览",
        image_preview_body: "这个历史任务还没有最终 SVG。",
        logs: "日志",
        job: "任务",
        fallback_title: "SVG-Edit 未安装",
        fallback_body:
          '请将 SVG-Edit 构建产物放到 <code>web/vendor/svg-edit/</code>（editor/index.html）下以启用编辑。',
        editor_error_title: "SVG-Edit 启动失败",
        artifacts: "素材",
        missing_job: "缺少 job id",
        resume: "从断点继续",
        resume_hint: "从已有产物续跑（跳过已完成步骤）",
        resuming: "正在续跑...",
        resume_need_profile: "请先在「模型与提供商」配置带 API Key 的配置。",
        resume_need_artifacts: "至少需要 figure.png 与 samed.png 才能续跑。",
        resume_failed: "续跑失败",
        svg_rerun_label: "SVG 预览比例",
        svg_rerun_model_label: "SVG 模型",
        svg_rerun_model_title: "重跑 SVG 使用的多模态模型 id。可点选推荐项，也可直接手填。",
        svg_rerun_btn: "重跑 SVG",
        svg_rerun_hint: "只重跑多模态 SVG 步骤，可改预览压缩比例与模型。SAM3 与图标抠图会直接复用。",
        svg_rerunning: "正在重跑 SVG...",
        svg_rerun_need_profile: "请先在「模型与提供商」配置带 API Key 的配置。",
        svg_rerun_need_artifacts: "至少需要 figure.png、samed.png 与图标产物才能重跑 SVG。",
        svg_rerun_failed: "重跑 SVG 失败",
        svg_rerun_running: "请等待当前任务结束后再重跑 SVG。",
        steps: {
          figure: "图片已生成",
          samed: "SAM3 分割完成",
          icon_raw: "图标已裁切",
          icon_nobg: "图标已去背景",
          template_svg: "模板 SVG 已就绪",
          optimized_template_svg: "优化模板已就绪",
          final_svg: "最终 SVG 已就绪",
        },
        pipeline: {
          eyebrow: "流水线执行",
          title: "AI 学术图表重构流水线",
          subtitle: "正在执行端到端多阶段图元检测、分割与矢量 SVG 重建",
          badge_running: "运行中",
          badge_failed: "执行失败",
          badge_done: "全部完成",
          badge_history: "历史结果",
          badge_disconnected: "连接断开",
          view_logs: "查看实时详细日志",
          enter_canvas: "进入画布",
          waiting_log: "等待引擎输出日志...",
          topbar_ready: "0% · 准备中",
          stage_history_ready: "已加载历史结果（未在运行）",
          stage_start: "步骤 1: 正在生成/准备学术位图...",
          stage_gen_figure: "步骤 1: 正在调用大模型生成学术位图...",
          stage_skip_figure: "跳过步骤 1，复用已有学术图片",
          stage_sam: "步骤 2: 正在运行 SAM3 语义分割与占位框检测...",
          stage_rmbg: "步骤 3: 正在裁切图元并调用 RMBG-2.0 透明化去背景...",
          stage_icons_ready: "步骤 3: 图元处理完成，正在准备多模态 SVG 提示...",
          stage_svg_build: "步骤 4: 多模态模型正在重构矢量 SVG 结构与代码...",
          stage_svg_optimize: "步骤 4.6: 正在对 SVG 矢量代码进行语法验证与布局优化...",
          stage_svg_align: "步骤 4.7: 正在进行坐标系对齐...",
          stage_template_ready: "步骤 4: SVG 重建就绪，正在准备最终装配...",
          stage_assemble: "步骤 5: 正在将处理好的矢量图元对齐并嵌入最终 SVG...",
          stage_all_done: "全部完成！可编辑分层矢量图已生成",
          stage_all_done_short: "全部 5 个阶段已顺利完成！",
          stage_failed: "任务异常中断（code {code}）",
          step1_title: "生图 / 导入",
          step1_desc: "figure.png",
          step2_title: "SAM 分割",
          step2_desc: "samed.png",
          step3_title: "图标去背景",
          step3_desc: "RMBG-2.0 抠图",
          step4_title: "SVG 重建",
          step4_desc: "template.svg",
          step5_title: "最终装配",
          step5_desc: "final.svg 画布",
        },
      },
      history: {
        nav: "历史图片",
        brand: "历史图片",
        subtitle: "已保存的 AutoFigure-Edit 输出。",
        back_input: "返回文本工作流",
        back_import: "返回导入工作流",
        refresh: "刷新",
        summary_title: "已保存图片",
        count: "{count} 项",
        loading: "正在加载...",
        empty_title: "暂无历史图片",
        empty_body: "运行结果写入 outputs/ 后，会显示在这里。",
        open: "打开",
        delete: "删除",
        delete_confirm: "确定要删除此历史记录（{job}）及其所有输出产物吗？",
        delete_failed: "删除失败",
        deleting: "正在删除...",
        complete: "已完成",
        partial: "未完成",
        artifacts: "{count} 个素材",
        updated: "更新于 {time}",
        unknown_time: "未知时间",
        provider_unknown: "未知渠道",
        model_unknown: "未知模型",
        scale_label: "预览 {scale}%",
        delete_title: "删除此记录？",
        delete_body: "将永久删除 {job} 及其全部产物文件。",
        delete_cancel: "取消",
        delete_confirm_btn: "删除",
      },
    },
  };

  function loadLocale() {
    try {
      const stored = window.localStorage.getItem(LOCALE_KEY);
      if (stored === "zh" || stored === "en") {
        return stored;
      }
    } catch (_err) {
      // Ignore storage failures.
    }
    const browserLang = (navigator.language || "").toLowerCase();
    return browserLang.startsWith("zh") ? "zh" : "en";
  }

  function saveLocale(locale) {
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch (_err) {
      // Ignore storage failures.
    }
  }

  function t(key, vars = {}) {
    const parts = key.split(".");
    let value = I18N[currentLocale];
    for (const part of parts) {
      value = value?.[part];
    }
    if (value == null) {
      value = I18N.en;
      for (const part of parts) {
        value = value?.[part];
      }
    }
    if (typeof value !== "string") {
      return key;
    }
    return value.replace(/\{(\w+)\}/g, (_, name) => `${vars[name] ?? ""}`);
  }

  function setLocale(locale) {
    if (locale !== "zh" && locale !== "en") {
      return;
    }
    currentLocale = locale;
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    saveLocale(locale);
    refreshLanguageSwitchers();
    for (const listener of localeListeners) {
      listener(currentLocale);
    }
  }

  function onLocaleChange(listener) {
    localeListeners.push(listener);
    listener(currentLocale);
  }

  function refreshLanguageSwitchers() {
    document.querySelectorAll("[data-lang-switch] .lang-chip").forEach((button) => {
      const active = button.dataset.lang === currentLocale;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function bindLanguageSwitchers() {
    document.querySelectorAll("[data-lang-switch] .lang-chip").forEach((button) => {
      button.addEventListener("click", () => setLocale(button.dataset.lang || "en"));
    });
    refreshLanguageSwitchers();
  }

  function setText(id, value) {
    const element = $(id);
    if (element) {
      element.textContent = value;
    }
  }

  function setHTML(id, value) {
    const element = $(id);
    if (element) {
      element.innerHTML = value;
    }
  }

  function setPlaceholder(id, value) {
    const element = $(id);
    if (element) {
      element.placeholder = value;
    }
  }

  function normalizeProviderValue(value) {
    const allowed = new Set(["bianxie", "gemini", "openai_response", "openrouter", "custom"]);
    const normalized = typeof value === "string" ? value.trim() : "";
    return allowed.has(normalized) ? normalized : "bianxie";
  }

  function normalizeImageProviderValue(value) {
    const allowed = new Set(["same", "openai", "bianxie", "gemini", "openrouter", "custom"]);
    const normalized = typeof value === "string" ? value.trim() : "";
    return allowed.has(normalized) ? normalized : "same";
  }

  function getProviderDisplayLabel(provider) {
    const normalized = normalizeProviderValue(provider);
    if (normalized === "openai_response") return t("providers.openai_response");
    if (normalized === "openrouter") return t("providers.openrouter");
    if (normalized === "bianxie") return t("providers.bianxie");
    if (normalized === "gemini") return t("providers.gemini");
    return t("providers.custom");
  }

  function getImageProviderDisplayLabel(provider) {
    const normalized = normalizeImageProviderValue(provider);
    if (normalized === "same") return t("providers.same_as_svg");
    if (normalized === "openai") return t("providers.openai_images");
    return getProviderDisplayLabel(normalized);
  }

  function profileHasApiKey(profile) {
    if (!profile) return false;
    return Boolean((profile.apiKey && String(profile.apiKey).trim()) || profile.apiKeySaved);
  }

  function buildProfileMetaText(profile) {
    if (!profile) return "";
    const providerLabel = getProviderDisplayLabel(profile.provider || "bianxie");
    const svgModel = profile.svgModel || getDefaultSvgModelForProvider(profile.provider || "bianxie");
    const imageProvider = normalizeImageProviderValue(profile.imageProvider || "same");
    const imageProviderLabel = getImageProviderDisplayLabel(imageProvider);
    const effectiveImageProvider =
      imageProvider === "same"
        ? normalizeProviderValue(profile.provider || "bianxie") === "openai_response"
          ? "openai"
          : normalizeProviderValue(profile.provider || "bianxie")
        : imageProvider;
    const imageModel =
      profile.imageModel || getDefaultImageModelForProvider(effectiveImageProvider);
    const keyLabel = profileHasApiKey(profile)
      ? t("input.profile_meta_key_saved")
      : t("input.profile_meta_key_missing");
    const imageLine = t("input.profile_meta_image", {
      provider: imageProviderLabel,
      model: imageModel,
    });
    return `${providerLabel} · ${svgModel} · ${keyLabel}\n${imageLine}`;
  }

  function getDefaultSvgModelForProvider(provider) {
    const normalized = normalizeProviderValue(provider);
    if (normalized === "openai_response") return "gpt-5.5";
    if (normalized === "openrouter") return "google/gemini-3.1-pro-preview";
    return "gemini-3.1-pro-preview";
  }

  function getDefaultImageModelForProvider(provider) {
    const normalized = provider === "openai" ? "openai" : normalizeProviderValue(provider);
    if (normalized === "openai" || normalized === "bianxie") return "gpt-image-2";
    if (normalized === "openrouter") return "google/gemini-3.1-flash-image-preview";
    return "gemini-3.1-flash-image-preview";
  }

  function setFieldValue(el, value) {
    if (el) el.value = value ?? "";
  }

  /**
   * Shared profile picker for input/import pages.
   * Switching a profile activates it globally (default for workflows).
   */
  function bindProviderProfilePicker(options) {
    const {
      selectId,
      emptyId,
      pickerId,
      nameId,
      metaId,
      manageLinkId,
      emptyTitleId,
      emptyCopyId,
      emptyLinkId,
      labelId,
      captionId,
      localePrefix = "input",
      onApply,
      onEmpty,
    } = options;

    const select = $(selectId);
    const emptyState = $(emptyId);
    const picker = $(pickerId);
    const nameEl = $(nameId);
    const metaEl = $(metaId);
    let profiles = [];
    let activeId = null;
    let bound = false;

    function applyLocale() {
      setText(labelId, t(`${localePrefix}.profile_picker_label`));
      setText(captionId, t(`${localePrefix}.profile_picker_caption`));
      setText(emptyTitleId, t(`${localePrefix}.profile_picker_empty_title`));
      setText(emptyCopyId, t(`${localePrefix}.profile_picker_empty_copy`));
      setText(emptyLinkId, t(`${localePrefix}.profile_picker_empty_link`));
      setText(manageLinkId, t(`${localePrefix}.profile_picker_manage`));
      if (activeId) {
        const profile = profiles.find((item) => item.id === activeId);
        if (profile && nameEl) nameEl.textContent = profile.name || "";
        if (profile && metaEl) metaEl.textContent = buildProfileMetaText(profile);
      }
    }

    function showEmpty() {
      profiles = [];
      activeId = null;
      if (emptyState) emptyState.hidden = false;
      if (picker) picker.hidden = true;
      if (select) select.innerHTML = "";
      if (nameEl) nameEl.textContent = "";
      if (metaEl) metaEl.textContent = "";
      if (typeof onEmpty === "function") onEmpty();
    }

    function showPicker(store, preferredId) {
      profiles = store?.profiles || [];
      if (!profiles.length) {
        showEmpty();
        return null;
      }
      activeId =
        preferredId ||
        store.activeProfileId ||
        profiles.find((item) => item.id === store.activeProfileId)?.id ||
        profiles[0].id;
      if (!profiles.some((item) => item.id === activeId)) {
        activeId = profiles[0].id;
      }
      if (emptyState) emptyState.hidden = true;
      if (picker) picker.hidden = false;
      if (select) {
        select.innerHTML = profiles
          .map((profile) => {
            const selected = profile.id === activeId ? " selected" : "";
            const label = profile.name || profile.id;
            return `<option value="${escapeHtmlAttr(profile.id)}"${selected}>${escapeHtmlText(label)}</option>`;
          })
          .join("");
      }
      const profile = profiles.find((item) => item.id === activeId) || profiles[0];
      if (nameEl) nameEl.textContent = profile.name || "";
      if (metaEl) metaEl.textContent = buildProfileMetaText(profile);
      return profile;
    }

    async function refresh(options = {}) {
      const { activateId = null, silent = false } = options;
      try {
        if (activateId) {
          try {
            await activateProviderProfile(activateId);
          } catch (err) {
            if (!silent) console.warn("Unable to activate provider profile", err);
          }
        }
        const store = await listProviderProfiles();
        let profile = showPicker(store, store.activeProfileId);
        if (!profile) return null;
        // Prefer decrypted active profile payload (includes apiKey in Tauri).
        const active = await getActiveProviderProfile();
        if (active) {
          profile = showPicker(store, active.id) || profile;
          // Re-fetch in case showPicker only had list metadata without secrets.
          const decrypted = await getActiveProviderProfile();
          if (decrypted) profile = decrypted;
          if (nameEl) nameEl.textContent = profile.name || "";
          if (metaEl) metaEl.textContent = buildProfileMetaText(profile);
        }
        if (typeof onApply === "function") onApply(profile);
        return profile;
      } catch (err) {
        if (!silent) console.warn("Unable to load provider profiles", err);
        showEmpty();
        return null;
      }
    }

    if (select && !bound) {
      bound = true;
      select.addEventListener("change", async () => {
        const nextId = select.value;
        if (!nextId) return;
        select.disabled = true;
        try {
          await refresh({ activateId: nextId });
        } finally {
          select.disabled = false;
        }
      });
    }

    return { refresh, applyLocale, showEmpty };
  }

  function escapeHtmlText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function escapeHtmlAttr(value) {
    return escapeHtmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function normalizeCustomBaseUrl(value) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return LEGACY_CUSTOM_BASE_URLS.has(trimmed) ? "" : trimmed;
  }

  function hasTauriInvoke() {
    return Boolean(window.__TAURI__?.core?.invoke);
  }

  function loadFallbackProviderStore() {
    try {
      const raw =
        window.localStorage.getItem(PROVIDER_PROFILE_FALLBACK_KEY) ||
        window.localStorage.getItem(LEGACY_PROVIDER_PROFILE_FALLBACK_KEY) ||
        "null";
      const parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.profiles)
        ? parsed
        : { activeProfileId: null, profiles: [] };
    } catch (_) {
      return { activeProfileId: null, profiles: [] };
    }
  }

  function saveFallbackProviderStore(store) {
    const safeStore = {
      ...store,
      profiles: (store.profiles || []).map(({ apiKey: _apiKey, imageApiKey: _imageApiKey, ...profile }) => ({
        ...profile,
        apiKeySaved: false,
        imageApiKeySaved: false,
      })),
    };
    window.localStorage.setItem(PROVIDER_PROFILE_FALLBACK_KEY, JSON.stringify(safeStore));
    return safeStore;
  }

  async function listProviderProfiles() {
    if (hasTauriInvoke()) {
      return window.__TAURI__.core.invoke("list_provider_profiles");
    }
    return loadFallbackProviderStore();
  }

  async function getActiveProviderProfile() {
    if (hasTauriInvoke()) {
      return window.__TAURI__.core.invoke("active_provider_profile");
    }
    const store = loadFallbackProviderStore();
    return store.profiles.find((profile) => profile.id === store.activeProfileId) || null;
  }

  async function saveProviderProfile(profile) {
    if (hasTauriInvoke()) {
      return window.__TAURI__.core.invoke("save_provider_profile", { profile });
    }
    const store = loadFallbackProviderStore();
    const id = profile.id || `provider-${Date.now()}`;
    const existing = store.profiles.find((item) => item.id === id);
    const next = {
      ...(existing || {}),
      ...profile,
      id,
      apiKeySaved: false,
      imageApiKeySaved: false,
      updatedAt: Math.floor(Date.now() / 1000),
    };
    const index = store.profiles.findIndex((item) => item.id === id);
    if (index >= 0) store.profiles[index] = next;
    else store.profiles.push(next);
    if (profile.makeActive !== false || !store.activeProfileId) store.activeProfileId = id;
    return saveFallbackProviderStore(store);
  }

  async function activateProviderProfile(id) {
    if (hasTauriInvoke()) {
      return window.__TAURI__.core.invoke("activate_provider_profile", { id });
    }
    const store = loadFallbackProviderStore();
    if (!store.profiles.some((profile) => profile.id === id)) throw new Error("找不到该提供商配置");
    store.activeProfileId = id;
    return saveFallbackProviderStore(store);
  }

  async function deleteProviderProfile(id) {
    if (hasTauriInvoke()) {
      return window.__TAURI__.core.invoke("delete_provider_profile", { id });
    }
    const store = loadFallbackProviderStore();
    store.profiles = store.profiles.filter((profile) => profile.id !== id);
    if (store.activeProfileId === id) store.activeProfileId = store.profiles[0]?.id || null;
    return saveFallbackProviderStore(store);
  }

  const page = document.body.dataset.page;
  bindLanguageSwitchers();
  if (page === "input") {
    initInputPage();
  } else if (page === "import") {
    initImportPage();
  } else if (page === "guide") {
    initGuidePage();
  } else if (page === "history") {
    initHistoryPage();
  } else if (page === "canvas") {
    initCanvasPage();
  } else if (page === "models") {
    initModelsPage();
  }

  function $(id) {
    return document.getElementById(id);
  }

  async function readApiJson(response) {
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let payload = null;

    if (contentType.includes("application/json") && text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        throw new Error(t("upload.engine_unavailable"));
      }
    }

    if (!response.ok) {
      throw new Error(payload?.detail || text || t("upload.request_failed"));
    }
    if (!contentType.includes("application/json") || !payload) {
      throw new Error(t("upload.engine_unavailable"));
    }
    return payload;
  }

  function getLocalModelStatus() {
    return engineFetch("/api/model-status", { cache: "no-store" }).then(readApiJson);
  }

  async function requireLocalModel(errorMsg) {
    try {
      const status = await getLocalModelStatus();
      const capabilities = status.capabilities || {};
      if (status.ready && capabilities.supportsLocalCpu) {
        return true;
      }
      if (errorMsg && status.ready) {
        errorMsg.textContent = "本地 SAM3 运行时缺少必要依赖，请重新安装应用或改用远程后端。";
        return false;
      }
    } catch (_) {
      // The server validates Local SAM3 again. Surface the action users can take.
    }
    if (errorMsg) {
      errorMsg.innerHTML = '本地 SAM3 模型尚未导入。<a href="/models.html">前往导入模型</a>';
    }
    return false;
  }

  function initInputPage() {
    const confirmBtn = $("confirmBtn");
    const errorMsg = $("errorMsg");
    const providerInput = $("provider");
    const imageProviderInput = $("imageProvider");
    const imageModelInput = $("imageModel");
    const svgModelInput = $("svgModel");
    const apiKeyInput = $("apiKey");
    const baseUrlInput = $("baseUrl");
    const imageApiKeyInput = $("imageApiKey");
    const imageBaseUrlInput = $("imageBaseUrl");
    const imageRouteSummary = $("imageRouteSummary");
    const svgRouteSummary = $("svgRouteSummary");
    const routeSummaryNote = $("routeSummaryNote");
    const uploadZone = $("uploadZone");
    const referenceFile = $("referenceFile");
    const referencePreview = $("referencePreview");
    const referenceStatus = $("referenceStatus");
    const imageSizeGroup = $("imageSizeGroup");
    const imageSizeInput = $("imageSize");
    const bianxieRegisterHint = $("bianxieRegisterHint");
    const upscaleEnabled = $("upscaleEnabled");
    const samBackend = $("samBackend");
    const samPrompt = $("samPrompt");
    const samApiKeyGroup = $("samApiKeyGroup");
    const samApiKeyInput = $("samApiKey");
    let uploadedReferencePath = null;
    let activeProfile = null;

    function getProviderLabel(provider) {
      return getProviderDisplayLabel(provider);
    }

    function getImageProviderLabel(provider) {
      return getImageProviderDisplayLabel(provider);
    }

    function loadInputState() {
      try {
        const raw = window.sessionStorage.getItem(INPUT_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (_err) {
        return null;
      }
    }

    function saveInputState() {
      const state = {
        methodText: $("methodText")?.value ?? "",
        optimizeIterations: $("optimizeIterations")?.value ?? "0",
        multimodalImageScale: normalizeMultimodalImageScale(
          $("multimodalImageScale")?.value ?? DEFAULT_MULTIMODAL_IMAGE_SCALE
        ),
        imageSize: imageSizeInput?.value ?? "4K",
        upscaleEnabled: upscaleEnabled?.checked ?? true,
        samBackend: samBackend?.value ?? "local",
        samPrompt: samPrompt?.value ?? "icon,person,robot,animal",
        referencePath: uploadedReferencePath,
        referenceUrl: referencePreview?.src ?? "",
        referenceStatus: referenceStatus?.textContent ?? "",
        activeProfileId: activeProfile?.id || null,
      };
      try {
        window.sessionStorage.setItem(INPUT_STATE_KEY, JSON.stringify(state));
      } catch (_err) {
        // Ignore storage failures (e.g. private mode / quota)
      }
    }

    function applyInputState() {
      const state = loadInputState();
      if (!state) return;
      if (typeof state.methodText === "string" && $("methodText")) {
        $("methodText").value = state.methodText;
      }
      if (typeof state.optimizeIterations === "string" && $("optimizeIterations")) {
        $("optimizeIterations").value = state.optimizeIterations;
      }
      if ($("multimodalImageScale")) {
        $("multimodalImageScale").value = normalizeMultimodalImageScale(
          state.multimodalImageScale ?? DEFAULT_MULTIMODAL_IMAGE_SCALE
        );
      }
      if (typeof state.imageSize === "string" && imageSizeInput) {
        imageSizeInput.value = state.imageSize;
      }
      if (typeof state.upscaleEnabled === "boolean" && upscaleEnabled) {
        upscaleEnabled.checked = state.upscaleEnabled;
      }
      if (typeof state.samBackend === "string" && samBackend) {
        samBackend.value = state.samBackend;
      }
      if (typeof state.samPrompt === "string" && samPrompt) {
        samPrompt.value = state.samPrompt;
      }
      if (typeof state.referencePath === "string" && state.referencePath) {
        uploadedReferencePath = state.referencePath;
      }
      if (referencePreview && typeof state.referenceUrl === "string" && state.referenceUrl) {
        referencePreview.src = state.referenceUrl;
        referencePreview.classList.add("visible");
      }
      if (referenceStatus && typeof state.referenceStatus === "string" && state.referenceStatus) {
        referenceStatus.textContent = state.referenceStatus;
      }
    }

    function clearProviderFields() {
      activeProfile = null;
      setFieldValue(providerInput, "bianxie");
      setFieldValue(imageProviderInput, "same");
      setFieldValue(svgModelInput, "");
      setFieldValue(imageModelInput, "");
      setFieldValue(baseUrlInput, "");
      setFieldValue(imageBaseUrlInput, "");
      setFieldValue(apiKeyInput, "");
      setFieldValue(imageApiKeyInput, "");
    }

    function applyProfileToFields(profile) {
      activeProfile = profile || null;
      if (!profile) {
        clearProviderFields();
        return;
      }
      setFieldValue(providerInput, normalizeProviderValue(profile.provider || "bianxie"));
      setFieldValue(
        imageProviderInput,
        normalizeImageProviderValue(profile.imageProvider || "same")
      );
      setFieldValue(svgModelInput, profile.svgModel || "");
      setFieldValue(imageModelInput, profile.imageModel || "");
      setFieldValue(baseUrlInput, normalizeCustomBaseUrl(profile.baseUrl || ""));
      setFieldValue(imageBaseUrlInput, normalizeCustomBaseUrl(profile.imageBaseUrl || ""));
      setFieldValue(apiKeyInput, profile.apiKey || "");
      setFieldValue(imageApiKeyInput, profile.imageApiKey || "");
    }

    function getEffectiveImageProvider() {
      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      const override = normalizeImageProviderValue(imageProviderInput?.value ?? "same");
      if (override !== "same") return override;
      return provider === "openai_response" ? "openai" : provider;
    }

    function getDefaultSvgModel(provider) {
      return getDefaultSvgModelForProvider(provider);
    }

    function getDefaultImageModel(provider) {
      return getDefaultImageModelForProvider(provider);
    }

    function getResolvedPrimaryBaseUrl() {
      return normalizeCustomBaseUrl(baseUrlInput?.value ?? DEFAULT_CUSTOM_BASE_URL);
    }

    function getResolvedImageBaseUrl() {
      const imageProviderSource = normalizeImageProviderValue(imageProviderInput?.value ?? "same");
      if (imageProviderSource === "same") return getResolvedPrimaryBaseUrl();
      return normalizeCustomBaseUrl(imageBaseUrlInput?.value ?? "") || getResolvedPrimaryBaseUrl();
    }

    function syncModelDefaults() {
      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      const effectiveImageProvider = getEffectiveImageProvider();

      if (svgModelInput) {
        const nextSvgDefault = getDefaultSvgModel(provider);
        const currentSvgValue = svgModelInput.value.trim();
        if (!currentSvgValue) svgModelInput.value = nextSvgDefault;
        svgModelInput.dataset.suggestedDefault = nextSvgDefault;
      }

      if (imageModelInput) {
        const nextImageDefault = getDefaultImageModel(effectiveImageProvider);
        const currentImageValue = imageModelInput.value.trim();
        if (!currentImageValue) imageModelInput.value = nextImageDefault;
        imageModelInput.dataset.suggestedDefault = nextImageDefault;
      }
    }

    function updateRouteSummary() {
      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      const effectiveImageProvider = getEffectiveImageProvider();
      const imageProviderSource = normalizeImageProviderValue(imageProviderInput?.value ?? "same");
      const selectedImageModel =
        imageModelInput?.value.trim() || getDefaultImageModel(effectiveImageProvider);
      const selectedSvgModel = svgModelInput?.value.trim() || getDefaultSvgModel(provider);
      const profilePrefix = activeProfile?.name ? `${activeProfile.name} · ` : "";

      const imageProviderLabel =
        imageProviderSource === "same"
          ? `${getProviderLabel(provider)} -> ${getImageProviderLabel(effectiveImageProvider)}`
          : getImageProviderLabel(effectiveImageProvider);

      const imageSuffix =
        effectiveImageProvider === "gemini" && imageSizeInput
          ? ` · ${imageSizeInput.value}`
          : "";
      const customSuffix =
        effectiveImageProvider === "custom"
          ? ` @ ${getResolvedImageBaseUrl() || t("input.custom_url_required")}`
          : "";
      const svgCustomSuffix =
        provider === "custom"
          ? ` @ ${getResolvedPrimaryBaseUrl() || t("input.custom_url_required")}`
          : "";

      if (imageRouteSummary) {
        imageRouteSummary.textContent = `${profilePrefix}${imageProviderLabel} · ${selectedImageModel}${imageSuffix}${customSuffix}`;
      }
      if (svgRouteSummary) {
        const providerLabel = getProviderLabel(provider);
        const routeKind =
          provider === "openai_response" ? t("routeKinds.responses") : t("routeKinds.default");
        svgRouteSummary.textContent = `${profilePrefix}${providerLabel} · ${selectedSvgModel} · ${routeKind}${svgCustomSuffix}`;
      }

      if (routeSummaryNote) {
        if (provider === "openai_response" && imageProviderSource === "same") {
          routeSummaryNote.textContent = t("input.route_note_openai_linked");
        } else if (imageProviderSource !== "same") {
          routeSummaryNote.textContent = t("input.route_note_override");
        } else {
          routeSummaryNote.textContent = t("input.route_note_linked");
        }
      }
    }

    function syncRoutingControls() {
      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      const effectiveImageProvider = getEffectiveImageProvider();
      syncModelDefaults();
      if (imageSizeGroup) {
        imageSizeGroup.hidden = effectiveImageProvider !== "gemini";
      }
      if (bianxieRegisterHint) {
        bianxieRegisterHint.hidden = provider !== "bianxie" && effectiveImageProvider !== "bianxie";
      }
      updateRouteSummary();
      saveInputState();
    }

    function syncSamApiKeyVisibility() {
      const shouldShow =
        samBackend && (samBackend.value === "fal" || samBackend.value === "roboflow");
      if (samApiKeyGroup) samApiKeyGroup.hidden = !shouldShow;
      if (!shouldShow && samApiKeyInput) samApiKeyInput.value = "";
      saveInputState();
    }

    const profilePicker = bindProviderProfilePicker({
      selectId: "providerProfileSelect",
      emptyId: "providerProfileEmptyState",
      pickerId: "providerProfilePicker",
      nameId: "providerProfileName",
      metaId: "providerProfileMeta",
      manageLinkId: "providerProfileManageLink",
      emptyTitleId: "profilePickerEmptyTitle",
      emptyCopyId: "profilePickerEmptyCopy",
      emptyLinkId: "profilePickerEmptyLink",
      labelId: "profilePickerLabel",
      captionId: "profilePickerCaption",
      localePrefix: "input",
      onApply(profile) {
        applyProfileToFields(profile);
        syncRoutingControls();
      },
      onEmpty() {
        clearProviderFields();
        syncRoutingControls();
      },
    });

    applyInputState();

    function applyInputLocale() {
      setText("inputPageSubtitle", t("input.subtitle"));
      setText("importEntryBtn", t("input.import_entry"));
      setText("inputGuideBtn", t("input.guide_entry"));
      setText("inputModelsBtn", t("input.models_entry"));
      setText("inputHistoryBtn", t("history.nav"));
      setText("methodTextLabel", t("input.method_label"));
      setPlaceholder("methodText", t("input.method_placeholder"));
      setText("methodHint", t("input.method_hint"));
      setText("pipelineRoutingLabel", t("input.pipeline_label"));
      setText("pipelineRoutingCaption", t("input.pipeline_caption"));
      setText("routeStep1Label", t("input.route_step1"));
      setText("routeStep4Label", t("input.route_step4"));
      profilePicker.applyLocale();
      setHTML("bianxieRegisterHint", t("input.bianxie_register_hint"));
      setText("optimizeLabel", t("input.optimize_label"));
      setText("multimodalScaleLabel", t("input.multimodal_scale_label"));
      setText("multimodalScaleCaption", t("input.multimodal_scale_caption"));
      fillMultimodalScaleOptions($("multimodalImageScale"));
      setText("imageSizeLabel", t("input.image_size_label"));
      setText("upscaleLabel", t("input.upscale_label"));
      setText("upscaleText", t("input.upscale_text"));
      setText("samBackendLabel", t("input.sam_backend_label"));
      setText("samPromptLabel", t("input.sam_prompt_label"));
      setText("samApiKeyLabel", t("input.sam_api_key_label"));
      setPlaceholder("samApiKey", t("input.sam_api_key_placeholder"));
      setText("referenceImageLabel", t("input.reference_image_label"));
      setText("referenceUploadText", t("input.reference_upload_text"));
      if (!confirmBtn.disabled) {
        confirmBtn.textContent = t("input.confirm_btn");
      }
      if (uploadedReferencePath && referenceStatus) {
        referenceStatus.textContent = t("upload.reference_ready");
      }
      updateRouteSummary();
    }

    onLocaleChange(applyInputLocale);

    if (imageSizeInput) {
      imageSizeInput.addEventListener("change", syncRoutingControls);
    }
    if (samBackend) {
      samBackend.addEventListener("change", syncSamApiKeyVisibility);
      syncSamApiKeyVisibility();
    }

    const rememberedProfileId = loadInputState()?.activeProfileId || null;
    profilePicker.refresh({ activateId: rememberedProfileId || undefined, silent: true }).then(() => {
      applyInputLocale();
    });
    applyInputLocale();
    syncRoutingControls();

    if (uploadZone && referenceFile) {
      uploadZone.addEventListener("click", () => referenceFile.click());
      uploadZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        uploadZone.classList.add("dragging");
      });
      uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("dragging");
      });
      uploadZone.addEventListener("drop", async (event) => {
        event.preventDefault();
        uploadZone.classList.remove("dragging");
        const file = event.dataTransfer.files[0];
        if (file) {
          const uploadedRef = await uploadReference(
            file,
            confirmBtn,
            referencePreview,
            referenceStatus
          );
          if (uploadedRef) {
            uploadedReferencePath = uploadedRef.path;
            saveInputState();
          }
        }
      });
      referenceFile.addEventListener("change", async () => {
        const file = referenceFile.files[0];
        if (file) {
          const uploadedRef = await uploadReference(
            file,
            confirmBtn,
            referencePreview,
            referenceStatus
          );
          if (uploadedRef) {
            uploadedReferencePath = uploadedRef.path;
            saveInputState();
          }
        }
      });
    }

    const autoSaveFields = [
      $("methodText"),
      $("optimizeIterations"),
      $("multimodalImageScale"),
      $("imageSize"),
      upscaleEnabled,
      samPrompt,
      samApiKeyInput,
    ];
    for (const field of autoSaveFields) {
      if (!field) continue;
      field.addEventListener("input", saveInputState);
      field.addEventListener("change", saveInputState);
    }

    confirmBtn.addEventListener("click", async () => {
      errorMsg.textContent = "";
      const methodText = $("methodText").value.trim();
      if (!methodText) {
        errorMsg.textContent = t("input.error_method_required");
        return;
      }
      if (!activeProfile) {
        errorMsg.textContent = t("input.error_profile_required");
        return;
      }
      if (!profileHasApiKey(activeProfile) && !(apiKeyInput?.value.trim() || "")) {
        errorMsg.textContent = t("input.error_api_key_required");
        return;
      }
      if ($("samBackend").value === "local" && !(await requireLocalModel(errorMsg))) {
        return;
      }

      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      const imageProvider = normalizeImageProviderValue(imageProviderInput?.value ?? "same");
      if (provider === "custom" && !getResolvedPrimaryBaseUrl()) {
        errorMsg.textContent = t("input.error_custom_base_url_required");
        return;
      }
      if (imageProvider === "custom" && !getResolvedImageBaseUrl()) {
        errorMsg.textContent = t("input.error_custom_image_base_url_required");
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = t("input.starting");

      const effectiveImageProvider = getEffectiveImageProvider();
      const selectedImageModel =
        imageModelInput?.value.trim() || getDefaultImageModel(effectiveImageProvider);
      const selectedSvgModel = svgModelInput?.value.trim() || getDefaultSvgModel(provider);

      const payload = {
        method_text: methodText,
        provider,
        api_key: apiKeyInput?.value.trim() || null,
        base_url: provider === "custom" ? getResolvedPrimaryBaseUrl() : null,
        image_provider: imageProvider !== "same" ? imageProvider : null,
        image_api_key: imageProvider !== "same" ? imageApiKeyInput?.value.trim() || null : null,
        image_base_url: imageProvider === "custom" ? getResolvedImageBaseUrl() : null,
        image_model: selectedImageModel,
        svg_model: selectedSvgModel,
        optimize_iterations: parseInt($("optimizeIterations").value, 10),
        multimodal_image_scale: Number(
          normalizeMultimodalImageScale($("multimodalImageScale")?.value)
        ),
        enable_upscale: upscaleEnabled?.checked ?? true,
        reference_image_path: uploadedReferencePath,
        sam_backend: $("samBackend").value,
        sam_prompt: $("samPrompt").value.trim() || null,
        sam_api_key: $("samApiKey").value.trim() || null,
      };
      if (effectiveImageProvider === "gemini") {
        payload.image_size = imageSizeInput?.value || "4K";
      }
      if (payload.sam_backend === "local") {
        payload.sam_api_key = null;
      }
      saveInputState();

      try {
        const response = await engineFetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await readApiJson(response);
        window.location.href = `/canvas.html?job=${encodeURIComponent(data.job_id)}&source=input`;
      } catch (err) {
        errorMsg.textContent = err.message || t("upload.failed_to_start");
        confirmBtn.disabled = false;
        confirmBtn.textContent = t("input.confirm_btn");
      }
    });
  }

  function initImportPage() {
    const confirmBtn = $("importConfirmBtn");
    const errorMsg = $("importErrorMsg");
    const uploadZone = $("importUploadZone");
    const figureFile = $("importFigureFile");
    const figurePreview = $("importFigurePreview");
    const figureStatus = $("importFigureStatus");
    const providerInput = $("importProvider");
    const svgModelInput = $("importSvgModel");
    const apiKeyInput = $("importApiKey");
    const bianxieRegisterHint = $("importBianxieRegisterHint");
    const baseUrlInput = $("importBaseUrl");
    const samBackend = $("importSamBackend");
    const samPrompt = $("importSamPrompt");
    const samApiKeyGroup = $("importSamApiKeyGroup");
    const samApiKeyInput = $("importSamApiKey");
    let uploadedFigurePath = null;
    let activeProfile = null;

    function loadImportState() {
      try {
        const raw = window.sessionStorage.getItem(IMPORT_STATE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (_err) {
        return null;
      }
    }

    function saveImportState() {
      const state = {
        samBackend: samBackend?.value ?? "local",
        samPrompt: samPrompt?.value ?? "icon,person,robot,animal",
        multimodalImageScale: normalizeMultimodalImageScale(
          $("importMultimodalImageScale")?.value ?? DEFAULT_MULTIMODAL_IMAGE_SCALE
        ),
        uploadedFigurePath,
        previewUrl: figurePreview?.src ?? "",
        figureStatus: figureStatus?.textContent ?? "",
        activeProfileId: activeProfile?.id || null,
      };
      try {
        window.sessionStorage.setItem(IMPORT_STATE_KEY, JSON.stringify(state));
      } catch (_err) {
        // Ignore storage failures.
      }
    }

    function applyImportState() {
      const state = loadImportState();
      if (!state) return;
      if (typeof state.samBackend === "string" && samBackend) {
        samBackend.value = state.samBackend;
      }
      if (typeof state.samPrompt === "string" && samPrompt) {
        samPrompt.value = state.samPrompt;
      }
      if ($("importMultimodalImageScale")) {
        $("importMultimodalImageScale").value = normalizeMultimodalImageScale(
          state.multimodalImageScale ?? DEFAULT_MULTIMODAL_IMAGE_SCALE
        );
      }
      if (typeof state.uploadedFigurePath === "string" && state.uploadedFigurePath) {
        uploadedFigurePath = state.uploadedFigurePath;
      }
      if (typeof state.previewUrl === "string" && state.previewUrl && figurePreview) {
        figurePreview.src = state.previewUrl;
        figurePreview.classList.add("visible");
      }
      if (typeof state.figureStatus === "string" && state.figureStatus && figureStatus) {
        figureStatus.textContent = state.figureStatus;
      }
    }

    function clearProviderFields() {
      activeProfile = null;
      setFieldValue(providerInput, "bianxie");
      setFieldValue(svgModelInput, "");
      setFieldValue(baseUrlInput, "");
      setFieldValue(apiKeyInput, "");
    }

    function applyProfileToFields(profile) {
      activeProfile = profile || null;
      if (!profile) {
        clearProviderFields();
        return;
      }
      setFieldValue(providerInput, normalizeProviderValue(profile.provider || "bianxie"));
      setFieldValue(svgModelInput, profile.svgModel || "");
      setFieldValue(baseUrlInput, normalizeCustomBaseUrl(profile.baseUrl || ""));
      setFieldValue(apiKeyInput, profile.apiKey || "");
    }

    function getDefaultSvgModel(provider) {
      return getDefaultSvgModelForProvider(provider);
    }

    function getResolvedImportBaseUrl() {
      return normalizeCustomBaseUrl(baseUrlInput?.value ?? DEFAULT_CUSTOM_BASE_URL);
    }

    function syncProviderDefaults() {
      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      if (svgModelInput && !svgModelInput.value.trim()) {
        svgModelInput.value = getDefaultSvgModel(provider);
      }
      if (bianxieRegisterHint) {
        bianxieRegisterHint.hidden = provider !== "bianxie";
      }
      saveImportState();
    }

    function syncSamApiKeyVisibility() {
      const shouldShow =
        samBackend && (samBackend.value === "fal" || samBackend.value === "roboflow");
      if (samApiKeyGroup) samApiKeyGroup.hidden = !shouldShow;
      if (!shouldShow && samApiKeyInput) samApiKeyInput.value = "";
      saveImportState();
    }

    const profilePicker = bindProviderProfilePicker({
      selectId: "importProviderProfileSelect",
      emptyId: "importProviderProfileEmptyState",
      pickerId: "importProviderProfilePicker",
      nameId: "importProviderProfileName",
      metaId: "importProviderProfileMeta",
      manageLinkId: "importProviderProfileManageLink",
      emptyTitleId: "importProfilePickerEmptyTitle",
      emptyCopyId: "importProfilePickerEmptyCopy",
      emptyLinkId: "importProfilePickerEmptyLink",
      labelId: "importProfilePickerLabel",
      captionId: "importProfilePickerCaption",
      localePrefix: "importPage",
      onApply(profile) {
        applyProfileToFields(profile);
        syncProviderDefaults();
      },
      onEmpty() {
        clearProviderFields();
        syncProviderDefaults();
      },
    });

    applyImportState();

    function applyImportLocale() {
      setText("importBrandTitle", t("importPage.brand"));
      setText("importPageSubtitle", t("importPage.subtitle"));
      setText("importBackLink", t("importPage.back"));
      setText("importGuideBtn", t("input.guide_entry"));
      setText("importModelsBtn", t("importPage.models_entry"));
      setText("importHistoryBtn", t("history.nav"));
      setText("importFigureLabel", t("importPage.figure_label"));
      setText("importUploadText", t("importPage.upload_text"));
      setHTML("importFigureHint", t("importPage.figure_hint"));
      setText("importRouteLabel", t("importPage.route_label"));
      setText("importRouteCaption", t("importPage.route_caption"));
      setText("importWorkflowLabel", t("importPage.workflow_label"));
      setText("importWorkflowValue", t("importPage.workflow_value"));
      setText("importStep1Label", t("importPage.step1_label"));
      setText("importStep1Value", t("importPage.step1_value"));
      setText("importRouteNote", t("importPage.route_note"));
      profilePicker.applyLocale();
      setHTML("importBianxieRegisterHint", t("importPage.bianxie_register_hint"));
      setText("importMultimodalScaleLabel", t("importPage.multimodal_scale_label"));
      setText("importMultimodalScaleCaption", t("importPage.multimodal_scale_caption"));
      fillMultimodalScaleOptions($("importMultimodalImageScale"));
      setText("importSamBackendLabel", t("importPage.sam_backend_label"));
      setText("importSamPromptLabel", t("importPage.sam_prompt_label"));
      setText("importSamApiKeyLabel", t("importPage.sam_api_key_label"));
      setPlaceholder("importSamApiKey", t("importPage.sam_api_key_placeholder"));
      if (!confirmBtn.disabled) {
        confirmBtn.textContent = t("importPage.confirm_btn");
      }
      if (uploadedFigurePath && figureStatus) {
        figureStatus.textContent = t("upload.stage1_ready");
      }
    }

    onLocaleChange(applyImportLocale);

    if (samBackend) {
      samBackend.addEventListener("change", syncSamApiKeyVisibility);
    }
    syncSamApiKeyVisibility();

    const rememberedProfileId = loadImportState()?.activeProfileId || null;
    profilePicker.refresh({ activateId: rememberedProfileId || undefined, silent: true }).then(() => {
      applyImportLocale();
    });
    applyImportLocale();
    syncProviderDefaults();

    if (uploadZone && figureFile) {
      uploadZone.addEventListener("click", () => figureFile.click());
      uploadZone.addEventListener("dragover", (event) => {
        event.preventDefault();
        uploadZone.classList.add("dragging");
      });
      uploadZone.addEventListener("dragleave", () => {
        uploadZone.classList.remove("dragging");
      });
      uploadZone.addEventListener("drop", async (event) => {
        event.preventDefault();
        uploadZone.classList.remove("dragging");
        const file = event.dataTransfer.files[0];
        if (file) {
          const uploaded = await uploadReference(file, confirmBtn, figurePreview, figureStatus);
          if (uploaded) {
            uploadedFigurePath = uploaded.path;
            saveImportState();
          }
        }
      });
      figureFile.addEventListener("change", async () => {
        const file = figureFile.files[0];
        if (file) {
          const uploaded = await uploadReference(file, confirmBtn, figurePreview, figureStatus);
          if (uploaded) {
            uploadedFigurePath = uploaded.path;
            saveImportState();
          }
        }
      });
    }

    const autoSaveFields = [samBackend, samPrompt, samApiKeyInput, $("importMultimodalImageScale")];
    for (const field of autoSaveFields) {
      if (!field) continue;
      field.addEventListener("input", saveImportState);
      field.addEventListener("change", saveImportState);
    }

    confirmBtn.addEventListener("click", async () => {
      errorMsg.textContent = "";
      if (!uploadedFigurePath) {
        errorMsg.textContent = t("importPage.error_upload_required");
        return;
      }
      if (!activeProfile) {
        errorMsg.textContent = t("importPage.error_profile_required");
        return;
      }
      if (!profileHasApiKey(activeProfile) && !(apiKeyInput?.value.trim() || "")) {
        errorMsg.textContent = t("importPage.error_api_key_required");
        return;
      }
      if (samBackend?.value === "local" && !(await requireLocalModel(errorMsg))) {
        return;
      }
      const provider = normalizeProviderValue(providerInput?.value ?? "bianxie");
      if (provider === "custom" && !getResolvedImportBaseUrl()) {
        errorMsg.textContent = t("importPage.error_custom_base_url_required");
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = t("importPage.starting");

      const payload = {
        input_figure_path: uploadedFigurePath,
        provider,
        api_key: apiKeyInput?.value.trim() || null,
        base_url: provider === "custom" ? getResolvedImportBaseUrl() : null,
        svg_model: svgModelInput?.value.trim() || null,
        multimodal_image_scale: Number(
          normalizeMultimodalImageScale($("importMultimodalImageScale")?.value)
        ),
        sam_backend: samBackend?.value ?? "local",
        sam_prompt: samPrompt?.value.trim() || null,
        sam_api_key: samApiKeyInput?.value.trim() || null,
      };
      if (payload.sam_backend === "local") {
        payload.sam_api_key = null;
      }
      saveImportState();

      try {
        const response = await engineFetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await readApiJson(response);
        window.location.href = `/canvas.html?job=${encodeURIComponent(data.job_id)}&source=import`;
      } catch (err) {
        errorMsg.textContent = err.message || t("upload.failed_to_start");
        confirmBtn.disabled = false;
        confirmBtn.textContent = t("importPage.confirm_btn");
      }
    });
  }

  function initModelsPage() {
    const importBtn = $("importModelBtn");
    const removeBtn = $("removeModelBtn");
    const statusBadge = $("modelStatusBadge");
    const statusCopy = $("modelStatusCopy");
    const details = $("modelDetails");
    const error = $("modelError");
    const progressArea = $("modelProgressArea");
    const progressBar = $("modelProgressBar");
    const progressText = $("modelProgressText");
    const progressLabel = $("modelProgressLabel");
    const importRmbgBtn = $("importRmbgBtn");
    const removeRmbgBtn = $("removeRmbgBtn");
    const rmbgStatusBadge = $("rmbgStatusBadge");
    const rmbgStatusCopy = $("rmbgStatusCopy");
    const rmbgDetails = $("rmbgDetails");
    const rmbgError = $("rmbgError");
    const rmbgProgressArea = $("rmbgProgressArea");
    const rmbgProgressBar = $("rmbgProgressBar");
    const rmbgProgressText = $("rmbgProgressText");
    const rmbgProgressLabel = $("rmbgProgressLabel");
    const profileList = $("providerProfileList");
    const profileEmpty = $("providerProfileEmpty");
    const profileForm = $("providerProfileForm");
    const profileError = $("providerProfileError");
    const profileProvider = $("profileProvider");
    const profileImageProvider = $("profileImageProvider");
    const profileBaseUrlGroup = $("profileBaseUrlGroup");
    const profileImageApiGroup = $("profileImageApiGroup");
    const profileImageBaseUrlGroup = $("profileImageBaseUrlGroup");
    const providerChannelChips = $("providerChannelChips");
    const svgModelPresets = $("svgModelPresets");
    const imageModelPresets = $("imageModelPresets");
    let importing = false;
    let importingRmbg = false;
    let loadingStatus = false;
    let profileStore = { activeProfileId: null, profiles: [] };

    const providerLabels = {
      bianxie: "便携AI",
      gemini: "Gemini",
      openai_response: "OpenAI Responses",
      openrouter: "OpenRouter",
      custom: "自定义中转",
      openai: "OpenAI Images",
      same: "跟随主提供商",
    };

    const defaultSvgModels = {
      bianxie: "gemini-3.1-pro-preview",
      gemini: "gemini-3.1-pro-preview",
      openai_response: "gpt-5.5",
      openrouter: "google/gemini-3.1-pro-preview",
      custom: "gemini-3.1-pro-preview",
    };

    const defaultImageModels = {
      bianxie: "gpt-image-2",
      gemini: "gemini-3.1-flash-image-preview",
      openai_response: "gpt-image-2",
      openrouter: "google/gemini-3.1-flash-image-preview",
      custom: "gemini-3.1-flash-image-preview",
      openai: "gpt-image-2",
    };

    const formatBytes = (value) => {
      if (!Number.isFinite(value)) return "—";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let size = value;
      let index = 0;
      while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index += 1;
      }
      return `${size.toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
    };

    const renderStatus = (status) => {
      const ready = Boolean(status?.ready);
      statusBadge.classList.toggle("is-ready", ready);
      statusBadge.classList.toggle("is-error", !ready);
      statusBadge.textContent = ready ? "模型已就绪" : "尚未导入模型";
      statusCopy.textContent = ready
        ? "Local (SAM3) 已就绪。FigOne 将使用 CPU Float32 进行本地推理加速。"
        : "请导入本地 sam3.pt，随后即可在工作流中选择 Local (SAM3)。";
      details.hidden = !ready;
      removeBtn.hidden = !ready;
      if (!ready) return;
      $("modelFileName").textContent = status.fileName || "sam3.pt";
      $("modelFileSize").textContent = formatBytes(status.sizeBytes);
      $("modelHash").textContent = status.sha256 || "未验证";
      $("modelImportedAt").textContent = status.importedAt
        ? new Date(status.importedAt * 1000).toLocaleString()
        : "外部开发模型";
      $("modelRuntime").textContent = status.runtime || "CPU Float32";
    };

    const renderRmbgStatus = (status) => {
      if (!rmbgStatusBadge || !rmbgStatusCopy) return;
      const ready = Boolean(status?.ready);
      rmbgStatusBadge.classList.toggle("is-ready", ready);
      rmbgStatusBadge.classList.toggle("is-error", !ready);
      rmbgStatusBadge.textContent = ready ? "权重已就绪" : "尚未导入权重";
      rmbgStatusCopy.textContent = ready
        ? "本地 RMBG-2.0 已就绪。步骤三将直接加载本地权重快速抠图。"
        : "网络结构已内置。请导入 model.safetensors（约 885 MB）。";
      if (rmbgDetails) rmbgDetails.hidden = !ready;
      if (removeRmbgBtn) removeRmbgBtn.hidden = !ready;
      if (!ready) return;
      if ($("rmbgFileName")) $("rmbgFileName").textContent = status.fileName || "model.safetensors";
      if ($("rmbgFileSize")) $("rmbgFileSize").textContent = formatBytes(status.sizeBytes);
      if ($("rmbgHash")) $("rmbgHash").textContent = status.sha256 || "未验证";
      if ($("rmbgImportedAt")) {
        $("rmbgImportedAt").textContent = status.importedAt
          ? new Date(status.importedAt * 1000).toLocaleString()
          : "已配置";
      }
    };

    const escapeHtml = (value) =>
      String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const renderProfiles = (store) => {
      profileStore = store || { activeProfileId: null, profiles: [] };
      const profiles = profileStore.profiles || [];
      profileEmpty.hidden = profiles.length > 0;
      profileList.hidden = profiles.length === 0;
      profileList.innerHTML = profiles
        .map((profile) => {
          const active = profile.id === profileStore.activeProfileId;
          const imageProvider = profile.imageProvider || "same";
          const imageProviderName = providerLabels[imageProvider] || imageProvider;
          const imageModelName = profile.imageModel || "跟随默认";
          return `
            <article class="provider-profile-item${active ? " is-active" : ""}" data-profile-id="${escapeHtml(profile.id)}">
              <div>
                <div class="provider-profile-title-row">
                  <span class="provider-profile-title">${escapeHtml(profile.name)}</span>
                  ${active ? '<span class="status-badge is-ready">当前默认</span>' : ""}
                  ${profile.apiKeySaved ? '<span class="status-badge is-ready" style="font-size:11px;">🔒 Key 已加密保存</span>' : '<span class="status-badge is-neutral" style="font-size:11px;">⚠️ 未保存 Key</span>'}
                </div>
                <div class="provider-route-tags">
                  <span class="route-tag reasoning">🧠 推理: ${escapeHtml(providerLabels[profile.provider] || profile.provider)} · ${escapeHtml(profile.svgModel)}</span>
                  <span class="route-tag image">🎨 生图: ${escapeHtml(imageProviderName)} · ${escapeHtml(imageModelName)}</span>
                </div>
              </div>
              <div class="provider-profile-actions">
                ${active ? "" : '<button type="button" class="ghost" data-action="activate">设为默认</button>'}
                <button type="button" class="ghost" data-action="edit">编辑</button>
                <button type="button" class="ghost danger-action" data-action="delete">删除</button>
              </div>
            </article>`;
        })
        .join("");
    };

    const syncProfileForm = () => {
      const provider = profileProvider.value;
      const imageProvider = profileImageProvider.value;
      profileBaseUrlGroup.hidden = provider !== "custom";
      profileImageApiGroup.hidden = imageProvider === "same";
      profileImageBaseUrlGroup.hidden = imageProvider !== "custom";

      // Sync visual channel chips
      if (providerChannelChips) {
        providerChannelChips.querySelectorAll(".channel-chip").forEach((chip) => {
          chip.classList.toggle("is-active", chip.dataset.providerVal === provider);
        });
      }

      const svgModel = $("profileSvgModel");
      const imageModel = $("profileImageModel");
      const previousSvgDefault = svgModel.dataset.suggestedDefault || "";
      const previousImageDefault = imageModel.dataset.suggestedDefault || "";
      const nextSvgDefault = defaultSvgModels[provider] || defaultSvgModels.custom;
      const effectiveImageProvider = imageProvider === "same"
        ? provider === "openai_response" ? "openai" : provider
        : imageProvider;
      const nextImageDefault = defaultImageModels[effectiveImageProvider] || defaultImageModels.custom;
      if (!svgModel.value.trim() || svgModel.value.trim() === previousSvgDefault) svgModel.value = nextSvgDefault;
      if (!imageModel.value.trim() || imageModel.value.trim() === previousImageDefault) imageModel.value = nextImageDefault;
      svgModel.dataset.suggestedDefault = nextSvgDefault;
      imageModel.dataset.suggestedDefault = nextImageDefault;
    };

    const openProfileForm = (profile = null) => {
      profileForm.hidden = false;
      profileError.textContent = "";
      $("providerFormTitle").textContent = profile ? "编辑渠道配置" : "添加提供商渠道";
      $("profileId").value = profile?.id || "";
      $("profileName").value = profile?.name || "";
      profileProvider.value = profile?.provider || "bianxie";
      $("profileSvgModel").value = profile?.svgModel || "";
      profileImageProvider.value = profile?.imageProvider || "same";
      $("profileImageModel").value = profile?.imageModel || "";
      $("profileBaseUrl").value = profile?.baseUrl || "";
      $("profileImageBaseUrl").value = profile?.imageBaseUrl || "";
      $("profileApiKey").value = "";
      $("profileImageApiKey").value = "";
      $("profileApiKey").placeholder = profile?.apiKeySaved ? "已加密保存；留空保持不变" : "sk-...";
      $("profileImageApiKey").placeholder = profile?.imageApiKeySaved ? "已加密保存；留空保持不变" : "默认复用主 Key";
      $("profileMakeActive").checked = profile ? profile.id === profileStore.activeProfileId : true;
      syncProfileForm();
      profileForm.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };

    const closeProfileForm = () => {
      profileForm.hidden = true;
      profileError.textContent = "";
      profileForm.reset();
    };

    const refreshProfiles = async () => {
      try {
        renderProfiles(await listProviderProfiles());
      } catch (err) {
        profileError.textContent = err?.message || String(err);
      }
    };

    // Bind Provider Channel Chips
    if (providerChannelChips) {
      providerChannelChips.addEventListener("click", (event) => {
        const chip = event.target.closest(".channel-chip");
        if (!chip || !chip.dataset.providerVal) return;
        profileProvider.value = chip.dataset.providerVal;
        syncProfileForm();
      });
    }

    // Bind SVG Model Presets
    if (svgModelPresets) {
      svgModelPresets.addEventListener("click", (event) => {
        const chip = event.target.closest(".preset-chip");
        if (!chip || !chip.dataset.model) return;
        $("profileSvgModel").value = chip.dataset.model;
      });
    }

    // Bind Image Model Presets
    if (imageModelPresets) {
      imageModelPresets.addEventListener("click", (event) => {
        const chip = event.target.closest(".preset-chip");
        if (!chip || !chip.dataset.imgModel) return;
        $("profileImageModel").value = chip.dataset.imgModel;
      });
    }

    // Bind Password Visibility Toggles
    document.querySelectorAll(".input-password-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.toggleTarget;
        const input = $(targetId);
        if (!input) return;
        const isPassword = input.type === "password";
        input.type = isPassword ? "text" : "password";
        btn.innerHTML = isPassword
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      });
    });

    const refresh = async () => {
      if (!hasTauriInvoke()) {
        statusBadge.classList.add("is-error");
        statusBadge.textContent = "模型状态仅在桌面应用可用";
        statusCopy.textContent = "请在 FigOne 桌面应用中管理本地 SAM3 模型。";
        importBtn.disabled = true;
        removeBtn.disabled = true;
        if (importRmbgBtn) importRmbgBtn.disabled = true;
        if (removeRmbgBtn) removeRmbgBtn.disabled = true;
        // Engine API can still report RMBG if shell already injected path.
        try {
          const response = await engineFetch("/api/rmbg-model-status", { cache: "no-store" });
          renderRmbgStatus(await readApiJson(response));
        } catch (_err) {
          /* ignore */
        }
        return;
      }

      loadingStatus = true;
      importBtn.disabled = true;
      removeBtn.disabled = true;
      if (importRmbgBtn) importRmbgBtn.disabled = true;
      if (removeRmbgBtn) removeRmbgBtn.disabled = true;
      try {
        renderStatus(await window.__TAURI__.core.invoke("model_status"));
      } catch (err) {
        statusBadge.classList.add("is-error");
        statusBadge.textContent = "模型管理不可用";
        statusCopy.textContent = "请在 FigOne 桌面应用中打开此页面。";
        error.textContent = err?.message || String(err);
      }
      try {
        renderRmbgStatus(await window.__TAURI__.core.invoke("rmbg_model_status"));
      } catch (_tauriErr) {
        try {
          const response = await engineFetch("/api/rmbg-model-status", { cache: "no-store" });
          renderRmbgStatus(await readApiJson(response));
        } catch (err) {
          if (rmbgStatusBadge) {
            rmbgStatusBadge.classList.add("is-error");
            rmbgStatusBadge.textContent = "状态不可用";
          }
          if (rmbgError) rmbgError.textContent = err?.message || String(err);
        }
      } finally {
        loadingStatus = false;
        importBtn.disabled = false;
        removeBtn.disabled = false;
        if (importRmbgBtn) importRmbgBtn.disabled = false;
        if (removeRmbgBtn) removeRmbgBtn.disabled = false;
      }
    };

    window.__TAURI__?.event?.listen?.("model-import-progress", (event) => {
      const progress = event.payload;
      const percentage = progress.totalBytes
        ? Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
        : 0;
      progressArea.hidden = false;
      progressBar.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}%`;
      progressLabel.textContent = progress.phase === "finalizing" ? "正在校验并完成导入…" : "正在复制模型…";
    });

    window.__TAURI__?.event?.listen?.("rmbg-import-progress", (event) => {
      if (!rmbgProgressArea) return;
      const progress = event.payload;
      const percentage = progress.totalBytes
        ? Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100))
        : 0;
      rmbgProgressArea.hidden = false;
      if (rmbgProgressBar) rmbgProgressBar.style.width = `${percentage}%`;
      if (rmbgProgressText) rmbgProgressText.textContent = `${percentage}%`;
      if (rmbgProgressLabel) {
        rmbgProgressLabel.textContent =
          progress.phase === "finalizing" ? "正在校验并完成导入…" : "正在复制 RMBG 权重…";
      }
    });

    importBtn.addEventListener("click", async () => {
      if (importing || loadingStatus || !hasTauriInvoke()) return;
      importing = true;
      error.textContent = "";
      importBtn.disabled = true;
      removeBtn.disabled = true;
      progressArea.hidden = false;
      progressBar.style.width = "0%";
      progressText.textContent = "0%";
      progressLabel.textContent = "正在选择模型文件…";
      try {
        renderStatus(await window.__TAURI__.core.invoke("import_sam3_model"));
      } catch (err) {
        const message = err?.message || String(err);
        if (!message.includes("已取消")) {
          error.textContent = message;
        }
      } finally {
        importing = false;
        importBtn.disabled = false;
        removeBtn.disabled = false;
        progressArea.hidden = true;
      }
    });

    removeBtn.addEventListener("click", async () => {
      if (!hasTauriInvoke()) return;
      if (!window.confirm("确定要从 FigOne 移除已导入的 SAM3 模型吗？原始模型文件不会受影响。")) {
        return;
      }
      error.textContent = "";
      removeBtn.disabled = true;
      try {
        renderStatus(await window.__TAURI__.core.invoke("remove_sam3_model"));
      } catch (err) {
        error.textContent = err?.message || String(err);
      } finally {
        removeBtn.disabled = false;
      }
    });

    if (importRmbgBtn) {
      importRmbgBtn.addEventListener("click", async () => {
        if (importingRmbg || loadingStatus || !hasTauriInvoke()) {
          if (!hasTauriInvoke() && rmbgError) {
            rmbgError.textContent = "请在 FigOne 桌面应用中导入 RMBG 权重。";
          }
          return;
        }
        importingRmbg = true;
        if (rmbgError) rmbgError.textContent = "";
        importRmbgBtn.disabled = true;
        if (removeRmbgBtn) removeRmbgBtn.disabled = true;
        if (rmbgProgressArea) rmbgProgressArea.hidden = false;
        if (rmbgProgressBar) rmbgProgressBar.style.width = "0%";
        if (rmbgProgressText) rmbgProgressText.textContent = "0%";
        if (rmbgProgressLabel) rmbgProgressLabel.textContent = "正在选择 model.safetensors…";
        try {
          renderRmbgStatus(await window.__TAURI__.core.invoke("import_rmbg_weights"));
          if (rmbgStatusCopy) {
            rmbgStatusCopy.textContent =
              "导入完成。请完全退出并重启 FigOne，再跑完整流程（引擎需重新加载模型路径）。";
          }
        } catch (err) {
          const message = err?.message || String(err);
          if (rmbgError && !message.includes("已取消")) {
            rmbgError.textContent = message;
          }
        } finally {
          importingRmbg = false;
          importRmbgBtn.disabled = false;
          if (removeRmbgBtn) removeRmbgBtn.disabled = false;
          if (rmbgProgressArea) rmbgProgressArea.hidden = true;
        }
      });
    }

    if (removeRmbgBtn) {
      removeRmbgBtn.addEventListener("click", async () => {
        if (!hasTauriInvoke()) return;
        if (!window.confirm("确定移除已导入的 RMBG 权重吗？原始下载文件不会被删除。")) {
          return;
        }
        if (rmbgError) rmbgError.textContent = "";
        removeRmbgBtn.disabled = true;
        try {
          renderRmbgStatus(await window.__TAURI__.core.invoke("remove_rmbg_model"));
        } catch (err) {
          if (rmbgError) rmbgError.textContent = err?.message || String(err);
        } finally {
          removeRmbgBtn.disabled = false;
        }
      });
    }

    $("newProviderProfileBtn").addEventListener("click", () => openProfileForm());
    $("cancelProviderProfileBtn").addEventListener("click", closeProfileForm);
    profileProvider.addEventListener("change", syncProfileForm);
    profileImageProvider.addEventListener("change", syncProfileForm);

    profileList.addEventListener("click", async (event) => {
      const actionButton = event.target.closest("[data-action]");
      const item = event.target.closest("[data-profile-id]");
      if (!actionButton || !item) return;
      const id = item.dataset.profileId;
      const profile = profileStore.profiles.find((entry) => entry.id === id);
      if (!profile) return;
      try {
        if (actionButton.dataset.action === "edit") {
          openProfileForm(profile);
        } else if (actionButton.dataset.action === "activate") {
          renderProfiles(await activateProviderProfile(id));
        } else if (
          actionButton.dataset.action === "delete" &&
          window.confirm(`确定删除“${profile.name}”吗？`)
        ) {
          renderProfiles(await deleteProviderProfile(id));
          if ($("profileId").value === id) closeProfileForm();
        }
      } catch (err) {
        profileError.textContent = err?.message || String(err);
      }
    });

    profileForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      profileError.textContent = "";
      const saveButton = $("saveProviderProfileBtn");
      saveButton.disabled = true;
      try {
        const store = await saveProviderProfile({
          id: $("profileId").value || null,
          name: $("profileName").value.trim(),
          provider: profileProvider.value,
          svgModel: $("profileSvgModel").value.trim(),
          imageProvider: profileImageProvider.value,
          imageModel: $("profileImageModel").value.trim() || null,
          baseUrl: $("profileBaseUrl").value.trim() || null,
          imageBaseUrl: $("profileImageBaseUrl").value.trim() || null,
          apiKey: $("profileApiKey").value.trim() || null,
          imageApiKey: $("profileImageApiKey").value.trim() || null,
          makeActive: $("profileMakeActive").checked,
        });
        renderProfiles(store);
        closeProfileForm();
      } catch (err) {
        profileError.textContent = err?.message || String(err);
      } finally {
        saveButton.disabled = false;
      }
    });

    refresh();
    refreshProfiles();
  }

  function initGuidePage() {
    function applyGuideLocale() {
      setText("guideBrandTitle", t("guide.brand"));
      setText("guideSubtitle", t("guide.subtitle"));
      setText("guideBackInputBtn", t("guide.back_input"));
      setText("guideBackImportBtn", t("guide.back_import"));
      setText("guideHistoryBtn", t("history.nav"));
      setText("guideOverviewTitle", t("guide.overview_title"));
      setText("guideOverviewCopy", t("guide.overview_copy"));
      setText("guideMethodKicker", t("guide.method_kicker"));
      setText("guideMethodTitle", t("guide.method_title"));
      setText("guideMethodCopy", t("guide.method_copy"));
      setText("guideImportKicker", t("guide.import_kicker"));
      setText("guideImportTitle", t("guide.import_title"));
      setText("guideImportCopy", t("guide.import_copy"));
      setText("guidePresetsTitle", t("guide.presets_title"));
      setText("guidePreset1Title", t("guide.preset1_title"));
      setText("guidePreset1Copy", t("guide.preset1_copy"));
      setText("guidePreset2Title", t("guide.preset2_title"));
      setText("guidePreset2Copy", t("guide.preset2_copy"));
      setText("guidePreset3Title", t("guide.preset3_title"));
      setText("guidePreset3Copy", t("guide.preset3_copy"));
      setText("guidePipelineStepsTitle", t("guide.pipeline_steps_title"));
      setText("guideStep1Kicker", t("guide.step1_kicker"));
      setText("guideStep1Title", t("guide.step1_title"));
      setText("guideStep1Copy", t("guide.step1_copy"));
      setText("guideStep2Kicker", t("guide.step2_kicker"));
      setText("guideStep2Title", t("guide.step2_title"));
      setText("guideStep2Copy", t("guide.step2_copy"));
      setText("guideStep3Kicker", t("guide.step3_kicker"));
      setText("guideStep3Title", t("guide.step3_title"));
      setText("guideStep3Copy", t("guide.step3_copy"));
      setText("guideStep4Kicker", t("guide.step4_kicker"));
      setText("guideStep4Title", t("guide.step4_title"));
      setText("guideStep4Copy", t("guide.step4_copy"));
      setText("guideStep5Kicker", t("guide.step5_kicker"));
      setText("guideStep5Title", t("guide.step5_title"));
      setText("guideStep5Copy", t("guide.step5_copy"));
      setText("guideMainStepsTitle", t("guide.main_steps_title"));
      setText("guideMainStep1Title", t("guide.main_step1_title"));
      setText("guideMainStep1Copy", t("guide.main_step1_copy"));
      setText("guideMainStep2Title", t("guide.main_step2_title"));
      setText("guideMainStep2Copy", t("guide.main_step2_copy"));
      setText("guideMainStep3Title", t("guide.main_step3_title"));
      setText("guideMainStep3Copy", t("guide.main_step3_copy"));
      setText("guideMainStep4Title", t("guide.main_step4_title"));
      setText("guideMainStep4Copy", t("guide.main_step4_copy"));
      setText("guideMainStep5Title", t("guide.main_step5_title"));
      setText("guideMainStep5Copy", t("guide.main_step5_copy"));
      setText("guideImportStepsTitle", t("guide.import_steps_title"));
      setText("guideImportStep1Title", t("guide.import_step1_title"));
      setText("guideImportStep1Copy", t("guide.import_step1_copy"));
      setText("guideImportStep2Title", t("guide.import_step2_title"));
      setText("guideImportStep2Copy", t("guide.import_step2_copy"));
      setText("guideImportStep3Title", t("guide.import_step3_title"));
      setText("guideImportStep3Copy", t("guide.import_step3_copy"));
      setText("guideImportStep4Title", t("guide.import_step4_title"));
      setText("guideImportStep4Copy", t("guide.import_step4_copy"));
      setText("guideFieldsTitle", t("guide.fields_title"));
      setText("guideFieldMethodTitle", t("guide.field_method_title"));
      setText("guideFieldMethodCopy", t("guide.field_method_copy"));
      setText("guideFieldProviderTitle", t("guide.field_provider_title"));
      setText("guideFieldProviderCopy", t("guide.field_provider_copy"));
      setText("guideFieldImageProviderTitle", t("guide.field_image_provider_title"));
      setText("guideFieldImageProviderCopy", t("guide.field_image_provider_copy"));
      setText("guideFieldCustomUrlTitle", t("guide.field_custom_url_title"));
      setText("guideFieldCustomUrlCopy", t("guide.field_custom_url_copy"));
      setText("guideFieldImageModelTitle", t("guide.field_image_model_title"));
      setText("guideFieldImageModelCopy", t("guide.field_image_model_copy"));
      setText("guideFieldSvgModelTitle", t("guide.field_svg_model_title"));
      setText("guideFieldSvgModelCopy", t("guide.field_svg_model_copy"));
      setText("guideFieldUpscaleTitle", t("guide.field_upscale_title"));
      setText("guideFieldUpscaleCopy", t("guide.field_upscale_copy"));
      setText("guideFieldSamTitle", t("guide.field_sam_title"));
      setText("guideFieldSamCopy", t("guide.field_sam_copy"));
      setText("guideSamTitle", t("guide.sam_title"));
      setText("guideSamLocalTitle", t("guide.sam_local_title"));
      setText("guideSamLocalCopy", t("guide.sam_local_copy"));
      setText("guideSamFalTitle", t("guide.sam_fal_title"));
      setText("guideSamFalCopy", t("guide.sam_fal_copy"));
      setText("guideSamRoboflowTitle", t("guide.sam_roboflow_title"));
      setText("guideSamRoboflowCopy", t("guide.sam_roboflow_copy"));
      setText("guideSamPromptTitle", t("guide.sam_prompt_title"));
      setText("guideSamPromptCopy", t("guide.sam_prompt_copy"));
      setText("guideSamWhenTitle", t("guide.sam_when_title"));
      setText("guideSamWhenCopy", t("guide.sam_when_copy"));
      setText("guideSamKeyTitle", t("guide.sam_key_title"));
      setText("guideSamKeyCopy", t("guide.sam_key_copy"));
      setText("guideExamplesTitle", t("guide.examples_title"));
      setText("guideExample1Title", t("guide.example1_title"));
      setText("guideExample1Copy", t("guide.example1_copy"));
      setText("guideExample2Title", t("guide.example2_title"));
      setText("guideExample2Copy", t("guide.example2_copy"));
      setText("guideExample3Title", t("guide.example3_title"));
      setText("guideExample3Copy", t("guide.example3_copy"));
      setText("guideHelpBadge", t("guide.help_badge"));
      setText("guideHelpTitle", t("guide.help_title"));
      setText("guideHelpCopy", t("guide.help_copy"));
      setText("guideHelpButtonText", t("guide.help_button"));
    }

    onLocaleChange(applyGuideLocale);
  }

  function initHistoryPage() {
    const grid = $("historyGrid");
    const empty = $("historyEmpty");
    const countEl = $("historyCount");
    const refreshBtn = $("historyRefreshBtn");
    const deleteDialog = $("historyDeleteDialog");
    const deleteTitle = $("historyDeleteTitle");
    const deleteBody = $("historyDeleteBody");
    const deleteCancel = $("historyDeleteCancel");
    const deleteConfirm = $("historyDeleteConfirm");
    let historyItems = [];
    let isLoading = false;
    let pendingDelete = null;

    function applyHistoryLocale() {
      setText("historyBrandTitle", t("history.brand"));
      setText("historySubtitle", t("history.subtitle"));
      setText("historyBackInputBtn", t("history.back_input"));
      setText("historyBackImportBtn", t("history.back_import"));
      setText("historyRefreshBtn", isLoading ? t("history.loading") : t("history.refresh"));
      setText("historySummaryTitle", t("history.summary_title"));
      setText("historyEmptyTitle", t("history.empty_title"));
      setText("historyEmptyBody", t("history.empty_body"));
      if (deleteTitle) deleteTitle.textContent = t("history.delete_title");
      if (deleteCancel) deleteCancel.textContent = t("history.delete_cancel");
      if (deleteConfirm) deleteConfirm.textContent = t("history.delete_confirm_btn");
      if (deleteBody && pendingDelete?.job_id) {
        deleteBody.textContent = t("history.delete_body", { job: pendingDelete.job_id });
      } else if (deleteBody) {
        deleteBody.textContent = t("history.delete_body", { job: "…" });
      }
      renderHistoryItems();
    }

    async function loadHistory() {
      if (isLoading) {
        return;
      }
      isLoading = true;
      if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = t("history.loading");
      }
      try {
        const response = await engineFetch("/api/history");
        if (!response.ok) {
          throw new Error("History request failed");
        }
        const data = await response.json();
        historyItems = Array.isArray(data.items) ? data.items : [];
      } catch (_err) {
        historyItems = [];
      } finally {
        isLoading = false;
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = t("history.refresh");
        }
        renderHistoryItems();
      }
    }

    function renderHistoryItems() {
      if (!grid || !countEl || !empty) {
        return;
      }
      countEl.textContent = t("history.count", { count: historyItems.length });
      grid.textContent = "";
      empty.hidden = historyItems.length > 0;

      for (const item of historyItems) {
        grid.appendChild(createHistoryCard(item));
      }
    }

    function createHistoryCard(item) {
      const card = document.createElement("article");
      card.className = "history-card";

      const openUrl = item.open_url || `/canvas.html?job=${encodeURIComponent(item.job_id)}&source=history`;

      const media = document.createElement("div");
      media.className = "history-card-media";
      const mediaLink = document.createElement("a");
      mediaLink.className = "history-card-media-link";
      mediaLink.href = openUrl;

      const img = document.createElement("img");
      img.src = item.thumbnail_url ? engineUrl(item.thumbnail_url) : "";
      img.alt = item.job_id || "";
      img.loading = "lazy";
      mediaLink.appendChild(img);
      media.appendChild(mediaLink);

      const body = document.createElement("div");
      body.className = "history-card-body";

      const topRow = document.createElement("div");
      topRow.className = "history-card-top";

      const title = document.createElement("a");
      title.className = "history-card-title";
      title.href = openUrl;
      title.textContent = item.job_id || "unknown";

      const status = document.createElement("div");
      status.className = `history-status ${item.status === "complete" ? "complete" : "partial"}`;
      status.textContent = item.status === "complete" ? t("history.complete") : t("history.partial");

      topRow.appendChild(title);
      topRow.appendChild(status);

      const meta = document.createElement("div");
      meta.className = "history-card-meta";
      meta.textContent = t("history.artifacts", { count: item.artifact_count || 0 });

      const badges = document.createElement("div");
      badges.className = "history-card-badges";
      const settings = item.settings || {};
      const providerChip = document.createElement("span");
      providerChip.className = "history-chip";
      providerChip.textContent =
        getProviderDisplayLabel(settings.provider) || t("history.provider_unknown");
      const modelChip = document.createElement("span");
      modelChip.className = "history-chip is-model";
      modelChip.textContent = settings.svg_model || t("history.model_unknown");
      badges.appendChild(providerChip);
      badges.appendChild(modelChip);
      if (settings.multimodal_image_scale != null) {
        const scaleChip = document.createElement("span");
        scaleChip.className = "history-chip";
        const scalePct = Math.round(Number(settings.multimodal_image_scale) * 100);
        scaleChip.textContent = t("history.scale_label", {
          scale: Number.isFinite(scalePct) ? scalePct : 50,
        });
        badges.appendChild(scaleChip);
      }

      const updated = document.createElement("div");
      updated.className = "history-card-updated";
      updated.textContent = t("history.updated", { time: formatHistoryTime(item.updated_at) });

      const actionsRow = document.createElement("div");
      actionsRow.className = "history-card-actions";

      const openBtn = document.createElement("a");
      openBtn.className = "history-card-action history-open-btn";
      openBtn.href = openUrl;
      openBtn.textContent = t("history.open");

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "history-delete-btn";
      deleteBtn.type = "button";
      deleteBtn.title = t("history.delete");
      deleteBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          <line x1="10" y1="11" x2="10" y2="17"></line>
          <line x1="14" y1="11" x2="14" y2="17"></line>
        </svg>
        <span>${t("history.delete")}</span>
      `;

      deleteBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const confirmed = await confirmHistoryDelete(item);
        if (!confirmed) return;

        deleteBtn.disabled = true;
        deleteBtn.innerHTML = `<span>${t("history.deleting")}</span>`;
        try {
          const res = await engineFetch(`/api/history/${encodeURIComponent(item.job_id)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const detail = errData.detail;
            const detailText = Array.isArray(detail)
              ? detail
                  .map((entry) =>
                    typeof entry === "string"
                      ? entry
                      : entry?.msg || JSON.stringify(entry)
                  )
                  .join("; ")
              : typeof detail === "object" && detail !== null
                ? detail.msg || JSON.stringify(detail)
                : detail;
            throw new Error(detailText || "Delete failed");
          }
          card.style.transition = "all 0.25s ease";
          card.style.opacity = "0";
          card.style.transform = "scale(0.95)";
          setTimeout(() => {
            historyItems = historyItems.filter((entry) => entry.job_id !== item.job_id);
            renderHistoryItems();
          }, 250);
        } catch (err) {
          alert(`${t("history.delete_failed")}: ${err.message || err}`);
          deleteBtn.disabled = false;
          deleteBtn.innerHTML = `
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
            <span>${t("history.delete")}</span>
          `;
        }
      });

      actionsRow.appendChild(openBtn);
      actionsRow.appendChild(deleteBtn);

      body.appendChild(topRow);
      body.appendChild(meta);
      body.appendChild(badges);
      body.appendChild(updated);
      body.appendChild(actionsRow);
      card.appendChild(media);
      card.appendChild(body);
      return card;
    }

    function confirmHistoryDelete(item) {
      return new Promise((resolve) => {
        pendingDelete = item;
        if (!deleteDialog || typeof deleteDialog.showModal !== "function") {
          resolve(window.confirm(t("history.delete_confirm", { job: item.job_id })));
          pendingDelete = null;
          return;
        }
        if (deleteTitle) deleteTitle.textContent = t("history.delete_title");
        if (deleteBody) {
          deleteBody.textContent = t("history.delete_body", { job: item.job_id });
        }
        if (deleteCancel) deleteCancel.textContent = t("history.delete_cancel");
        if (deleteConfirm) deleteConfirm.textContent = t("history.delete_confirm_btn");

        const onClose = () => {
          deleteDialog.removeEventListener("close", onClose);
          const ok = deleteDialog.returnValue === "confirm";
          pendingDelete = null;
          resolve(ok);
        };
        deleteDialog.addEventListener("close", onClose, { once: true });
        deleteDialog.returnValue = "cancel";
        deleteDialog.showModal();
      });
    }

    function formatHistoryTime(value) {
      if (!value) {
        return t("history.unknown_time");
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return t("history.unknown_time");
      }
      return new Intl.DateTimeFormat(currentLocale === "zh" ? "zh-CN" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", loadHistory);
    }
    onLocaleChange(applyHistoryLocale);
    loadHistory();
  }

  async function uploadReference(file, confirmBtn, previewEl, statusEl) {
    if (!file.type.startsWith("image/")) {
      statusEl.textContent = t("upload.only_images");
      return null;
    }

    confirmBtn.disabled = true;
    statusEl.textContent = t("upload.uploading");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await engineFetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await readApiJson(response);
      const isImport = statusEl?.id === "importFigureStatus";
      statusEl.textContent = t(
        isImport ? "upload.uploaded_stage1" : "upload.uploaded_reference",
        { name: data.name }
      );
      if (previewEl) {
        previewEl.src = data.url ? engineUrl(data.url) : "";
        previewEl.classList.add("visible");
      }
      return {
        path: data.path || null,
        url: data.url ? engineUrl(data.url) : "",
        name: data.name || "",
      };
    } catch (err) {
      statusEl.textContent = err.message || t("upload.upload_failed");
      return null;
    } finally {
      confirmBtn.disabled = false;
    }
  }

  async function initCanvasPage() {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get("job");
    const source = params.get("source");
    const statusText = $("statusText");
    const jobIdEl = $("jobId");
    const artifactPanel = $("artifactPanel");
    const artifactList = $("artifactList");
    const toggle = $("artifactToggle");
    const logToggle = $("logToggle");
    const backToConfigBtn = $("backToConfigBtn");
    const resumeJobBtn = $("resumeJobBtn");
    const regenerateSvgBtn = $("regenerateSvgBtn");
    const svgRerunControls = $("svgRerunControls");
    const canvasMultimodalImageScale = $("canvasMultimodalImageScale");
    const canvasSvgModel = $("canvasSvgModel");
    const logPanel = $("logPanel");
    const logBody = $("logBody");
    const iframe = $("svgEditorFrame");
    const fallback = $("svgFallback");
    const fallbackObject = $("fallbackObject");
    let currentStep = 0;
    let currentPercentage = 0;
    let lastPipelineLabel = "";
    let isFinished = false;
    // History opens are snapshots — never start in the live "waiting/running" chrome.
    let statusState = source === "history" ? "history" : "waiting";
    let fallbackMode = "editor";
    let preferredSvgModel = "";
    let editorErrorMessage = "";
    let preferredMultimodalScale = DEFAULT_MULTIMODAL_IMAGE_SCALE;

    if (!jobId) {
      statusText.textContent = t("canvas.missing_job");
      return;
    }

    function applyPipelineBadge() {
      const badge = $("pipelineStatusBadge");
      if (!badge) return;
      if (statusState === "failed") {
        badge.className = "status-badge is-error";
        badge.textContent = t("canvas.pipeline.badge_failed");
      } else if (statusState === "done") {
        badge.className = "status-badge is-ready";
        badge.textContent = t("canvas.pipeline.badge_done");
      } else if (statusState === "history") {
        badge.className = "status-badge is-neutral";
        badge.textContent = t("canvas.pipeline.badge_history");
      } else if (statusState === "disconnected") {
        badge.className = "status-badge is-error";
        badge.textContent = t("canvas.pipeline.badge_disconnected");
      } else if (statusState === "running") {
        badge.className = "status-badge is-ready";
        badge.textContent = t("canvas.pipeline.badge_running");
      } else {
        // waiting / idle — not an active run
        badge.className = "status-badge is-neutral";
        badge.textContent = t("canvas.waiting");
      }
      const statusDotEl = $("canvasStatusDot");
      if (statusDotEl) {
        statusDotEl.dataset.state =
          statusState === "waiting"
            ? "waiting"
            : statusState === "running"
              ? "running"
              : statusState === "history"
                ? "history"
                : statusState === "done"
                  ? "done"
                  : statusState === "failed" || statusState === "disconnected"
                    ? statusState
                    : "waiting";
      }
      const toggleBtn = $("pipelineToggleBtn");
      if (toggleBtn) {
        toggleBtn.classList.toggle(
          "is-done",
          statusState === "done" || statusState === "history"
        );
      }
    }

    function setCanvasLocale() {
      setText("canvasBrandTitle", t("canvas.brand"));
      setText("canvasStatusLabel", t("canvas.status_label"));
      setText("canvasJobLabel", t("canvas.job"));
      setText(
        "fallbackTitle",
        fallbackMode === "history_image"
          ? t("canvas.image_preview_title")
          : fallbackMode === "editor_error"
            ? t("canvas.editor_error_title")
            : t("canvas.fallback_title")
      );
      if (fallbackMode === "history_image") {
        setHTML("fallbackBody", t("canvas.image_preview_body"));
      } else if (fallbackMode === "editor_error") {
        setHTML(
          "fallbackBody",
          editorErrorMessage || t("canvas.editor_error_title")
        );
      } else {
        setHTML("fallbackBody", t("canvas.fallback_body"));
      }
      setText("artifactPanelTitle", t("canvas.artifacts"));
      setText("logPanelTitle", t("canvas.logs"));
      setText("logToggle", t("canvas.logs"));
      setText("canvasHistoryBtn", t("history.nav"));
      if (backToConfigBtn) {
        if (source === "history") {
          backToConfigBtn.textContent = t("canvas.back_history");
        } else {
          backToConfigBtn.textContent =
            source === "import" ? t("canvas.back_import") : t("canvas.back_config");
        }
      }
      if (resumeJobBtn) {
        resumeJobBtn.textContent = t("canvas.resume");
        resumeJobBtn.title = t("canvas.resume_hint");
      }
      if (regenerateSvgBtn) {
        regenerateSvgBtn.textContent = t("canvas.svg_rerun_btn");
        regenerateSvgBtn.title = t("canvas.svg_rerun_hint");
      }
      setText("svgRerunScaleLabel", t("canvas.svg_rerun_label"));
      setText("canvasSvgModelLabel", t("canvas.svg_rerun_model_label"));
      fillMultimodalScaleOptions(canvasMultimodalImageScale, { shortLabels: true });
      if (canvasMultimodalImageScale) {
        canvasMultimodalImageScale.value = normalizeMultimodalImageScale(preferredMultimodalScale);
      }
      if (canvasSvgModel) {
        canvasSvgModel.title = t("canvas.svg_rerun_model_title");
        canvasSvgModel.placeholder = preferredSvgModel || getDefaultSvgModelForProvider("bianxie");
        if (preferredSvgModel) canvasSvgModel.value = preferredSvgModel;
      }

      // Pipeline overlay chrome (lookup by id so this can run before element consts)
      setText("pipelineEyebrow", t("canvas.pipeline.eyebrow"));
      setText("pipelineTitle", t("canvas.pipeline.title"));
      setText("pipelineSubtitle", t("canvas.pipeline.subtitle"));
      const pipelineLogsLabel = document.querySelector("#pipelineToggleLogsBtn span");
      if (pipelineLogsLabel) pipelineLogsLabel.textContent = t("canvas.pipeline.view_logs");
      const pipelineHideLabel = document.querySelector("#pipelineHideOverlayBtn span");
      if (pipelineHideLabel) pipelineHideLabel.textContent = t("canvas.pipeline.enter_canvas");
      const stepTitleKeys = [
        ["1", "step1_title", "step1_desc"],
        ["2", "step2_title", "step2_desc"],
        ["3", "step3_title", "step3_desc"],
        ["4", "step4_title", "step4_desc"],
        ["5", "step5_title", "step5_desc"],
      ];
      const stepper = $("pipelineStepper");
      if (stepper) {
        stepTitleKeys.forEach(([id, titleKey, descKey]) => {
          const item = stepper.querySelector(`.step-item[data-step-id="${id}"]`);
          if (!item) return;
          const titleEl = item.querySelector(".step-title");
          const descEl = item.querySelector(".step-desc");
          if (titleEl) titleEl.textContent = t(`canvas.pipeline.${titleKey}`);
          if (descEl) descEl.textContent = t(`canvas.pipeline.${descKey}`);
        });
      }
      const liveLogEl = $("pipelineLiveLog");
      if (liveLogEl && (!liveLogEl.textContent || liveLogEl.dataset.i18nDefault === "1")) {
        liveLogEl.textContent = t("canvas.pipeline.waiting_log");
        liveLogEl.dataset.i18nDefault = "1";
      }
      applyPipelineBadge();
      const stageEl = $("pipelineCurrentStageText");
      const topbarEl = $("topbarProgressText");
      const percentEl = $("pipelinePercent");
      const stageLabel =
        lastPipelineLabel ||
        (statusState === "history"
          ? t("canvas.pipeline.stage_history_ready")
          : t("canvas.pipeline.stage_start"));
      if (stageEl) stageEl.textContent = stageLabel;
      if (topbarEl) topbarEl.textContent = `${currentPercentage}% · ${stageLabel}`;
      if (percentEl) percentEl.textContent = `${currentPercentage}%`;
      if (sideProgressTitle && statusState === "history" && !lastPipelineLabel) {
        sideProgressTitle.textContent = t("canvas.pipeline.stage_history_ready");
      }
      if (sideLiveLog && statusState === "history" && sideLiveLog.dataset.i18nDefault !== "0") {
        sideLiveLog.textContent = t("canvas.history_ready");
      }

      if (statusState === "waiting") {
        statusText.textContent = t("canvas.waiting");
      } else if (statusState === "running") {
        statusText.textContent = t("canvas.running");
      } else if (statusState === "disconnected") {
        statusText.textContent = t("canvas.disconnected");
      } else if (statusState === "done") {
        statusText.textContent = t("canvas.done");
      } else if (statusState === "failed") {
        statusText.textContent = t("canvas.failed");
      } else if (statusState === "history") {
        statusText.textContent = t("canvas.history_ready");
      }
    }

    onLocaleChange(setCanvasLocale);

    jobIdEl.textContent = jobId;

    const sidePanel = $("canvasSidePanel");
    const sideTabButtons = Array.from(document.querySelectorAll("[data-panel-tab]"));
    const sideProgressTitle = $("sideProgressTitle");
    const sideProgressPercent = $("sideProgressPercent");
    const sideProgressTimer = $("sideProgressTimer");
    const sideProgressFill = $("sideProgressFill");
    const sideLiveLog = $("sideLiveLog");
    const sideOpenPipelineBtn = $("sideOpenPipelineBtn");
    const statusDot = $("canvasStatusDot");
    const stepRail = $("stepRail");
    const stepRailToggle = $("stepRailToggle");
    const logsFilterInput = $("logsFilterInput");
    const artifactLightbox = $("artifactLightbox");
    const artifactLightboxTitle = $("artifactLightboxTitle");
    const artifactLightboxImage = $("artifactLightboxImage");
    const artifactLightboxObject = $("artifactLightboxObject");
    const artifactLightboxOpen = $("artifactLightboxOpen");

    function setSidePanelTab(tabName) {
      const next = tabName || "progress";
      sideTabButtons.forEach((btn) => {
        btn.classList.toggle("is-active", btn.getAttribute("data-panel-tab") === next);
      });
      document.querySelectorAll("[data-panel-body]").forEach((body) => {
        const active = body.getAttribute("data-panel-body") === next;
        body.hidden = !active;
        body.classList.toggle("open", active);
      });
      if (sidePanel) {
        sidePanel.dataset.activeTab = next;
      }
    }

    function openArtifactLightbox(data) {
      if (!artifactLightbox || !data?.url) return;
      const url = engineUrl(data.url);
      const title = data.name || data.path || "Artifact";
      if (artifactLightboxTitle) artifactLightboxTitle.textContent = title;
      if (artifactLightboxOpen) {
        artifactLightboxOpen.href = url;
      }
      const previewable = isPreviewableArtifact(data.kind);
      const isSvg =
        data.kind === "template_svg" ||
        data.kind === "optimized_template_svg" ||
        data.kind === "final_svg" ||
        /\.svg($|\?)/i.test(url);
      if (artifactLightboxImage) {
        artifactLightboxImage.hidden = !(previewable && !isSvg);
        if (!artifactLightboxImage.hidden) {
          artifactLightboxImage.src = url;
          artifactLightboxImage.alt = title;
        } else {
          artifactLightboxImage.removeAttribute("src");
        }
      }
      if (artifactLightboxObject) {
        artifactLightboxObject.hidden = !(previewable && isSvg);
        if (!artifactLightboxObject.hidden) {
          artifactLightboxObject.data = url;
        } else {
          artifactLightboxObject.removeAttribute("data");
        }
      }
      if (typeof artifactLightbox.showModal === "function" && !artifactLightbox.open) {
        artifactLightbox.showModal();
      }
    }

    function applyLogFilter() {
      if (!logBody || !logsFilterInput) return;
      const query = (logsFilterInput.value || "").trim().toLowerCase();
      const lines = logBody.querySelectorAll(".log-line-item");
      if (!lines.length) {
        // Fallback for plain-text log body.
        if (!query) return;
        return;
      }
      lines.forEach((line) => {
        const text = (line.textContent || "").toLowerCase();
        line.hidden = Boolean(query) && !text.includes(query);
      });
    }

    sideTabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        setSidePanelTab(btn.getAttribute("data-panel-tab"));
      });
    });
    setSidePanelTab("progress");

    if (toggle) {
      toggle.addEventListener("click", () => {
        setSidePanelTab("artifacts");
        if (artifactPanel) artifactPanel.classList.add("open");
      });
    }

    if (logToggle) {
      logToggle.addEventListener("click", () => {
        setSidePanelTab("logs");
        if (logPanel) logPanel.classList.add("open");
      });
    }

    if (logsFilterInput) {
      logsFilterInput.addEventListener("input", applyLogFilter);
    }

    if (stepRailToggle && stepRail) {
      stepRailToggle.addEventListener("click", () => {
        stepRail.classList.toggle("is-collapsed");
      });
    }

    if (stepRail) {
      stepRail.querySelectorAll(".step-rail-item[data-step-id]").forEach((item) => {
        item.addEventListener("click", () => {
          setSidePanelTab("artifacts");
        });
      });
    }

    if (artifactList) {
      artifactList.addEventListener("click", (event) => {
        const card = event.target?.closest?.("a.artifact-card");
        if (!card) return;
        const kind = card.getAttribute("data-kind") || "";
        if (!isPreviewableArtifact(kind)) return;
        event.preventDefault();
        openArtifactLightbox({
          kind,
          name: card.querySelector(".artifact-name")?.textContent || card.getAttribute("data-path") || "",
          path: card.getAttribute("data-path") || "",
          url: card.getAttribute("href") || "",
        });
      });
    }

    if (backToConfigBtn) {
      backToConfigBtn.addEventListener("click", () => {
        if (source === "history") {
          window.location.href = "/history.html";
        } else {
          window.location.href = source === "import" ? "/import.html" : "/";
        }
      });
    }

    let svgEditAvailable = false;
    let svgEditPath = null;
    try {
      const configRes = await engineFetch("/api/config");
      if (configRes.ok) {
        const config = await configRes.json();
        svgEditAvailable = Boolean(config.svgEditAvailable);
        svgEditPath = config.svgEditPath || null;
      }
    } catch (err) {
      svgEditAvailable = false;
    }

    if (svgEditAvailable && svgEditPath) {
      iframe.src = svgEditPath;
    } else {
      fallbackMode = "editor";
      fallback.classList.add("active");
      iframe.style.display = "none";
      setCanvasLocale();
    }

    let svgReady = false;
    let pendingSvgText = null;
    let pendingSvgUrl = null;
    let editorReadyTimer = null;
    let editorReadyTimeout = null;

    function showEditorFallback(message, { hideIframe = true } = {}) {
      editorErrorMessage = message || t("canvas.editor_error_title");
      fallbackMode = "editor_error";
      if (hideIframe) {
        iframe.style.display = "none";
      }
      fallback.classList.add("active");
      if (pendingSvgUrl) {
        fallbackObject.data = engineUrl(pendingSvgUrl);
      }
      setCanvasLocale();
    }

    function reportCanvasError(message, options) {
      appendLogLine(logBody, { stream: "canvas", line: message });
      // Bundled install already has SVG-Edit; init/load failures must not look like "not installed".
      if (svgEditAvailable) {
        showEditorFallback(message, options);
      } else {
        fallbackMode = "editor";
        fallback.classList.add("active");
        iframe.style.display = "none";
        setCanvasLocale();
      }
    }

    function markSvgEditorReady() {
      svgReady = true;
      if (editorReadyTimer) {
        clearInterval(editorReadyTimer);
        editorReadyTimer = null;
      }
      if (editorReadyTimeout) {
        clearTimeout(editorReadyTimeout);
        editorReadyTimeout = null;
      }
      // Recover from a previous timeout overlay if init eventually succeeds.
      if (fallbackMode === "editor_error") {
        fallbackMode = "editor";
        editorErrorMessage = "";
        fallback.classList.remove("active");
        iframe.style.display = "";
      }
      if (pendingSvgText) {
        const svgText = pendingSvgText;
        pendingSvgText = null;
        void tryLoadSvg(svgText);
      }
    }

    window.addEventListener("message", (event) => {
      if (event.source !== iframe.contentWindow) return;
      if (
        event.data?.type === "figone-svg-editor-ready" ||
        event.data?.type === "figra-svg-editor-ready"
      ) {
        markSvgEditorReady();
      } else if (
        event.data?.type === "figone-svg-editor-error" ||
        event.data?.type === "figra-svg-editor-error"
      ) {
        reportCanvasError(
          `SVG-Edit 初始化失败: ${event.data.message || "unknown error"}`
        );
      }
    });

    function waitForSvgEditorReady() {
      if (!svgEditAvailable || svgReady) return;
      if (editorReadyTimer) {
        clearInterval(editorReadyTimer);
        editorReadyTimer = null;
      }
      if (editorReadyTimeout) {
        clearTimeout(editorReadyTimeout);
        editorReadyTimeout = null;
      }
      editorReadyTimer = setInterval(() => {
        const win = iframe.contentWindow;
        // Prefer a fully initialized editor (loadFromString), fall back to constructor global.
        if (
          win?.svgEditor &&
          (typeof win.svgEditor.loadFromString === "function" ||
            typeof win.svgEditor.init === "function")
        ) {
          // Constructor runs before async init; only mark ready after host can load SVG
          // or after the embed posts figra-svg-editor-ready. Polling loadFromString is enough.
          if (typeof win.svgEditor.loadFromString === "function") {
            markSvgEditorReady();
          }
        }
      }, 100);
      editorReadyTimeout = setTimeout(() => {
        if (!svgReady) {
          reportCanvasError("SVG-Edit 在限定时间内未完成初始化。");
        }
      }, 30000);
    }

    iframe.addEventListener("load", () => {
      waitForSvgEditorReady();
      if (
        pendingSvgText &&
        typeof iframe.contentWindow?.svgEditor?.loadFromString === "function"
      ) {
        markSvgEditorReady();
      }
    });
    iframe.addEventListener("error", () => {
      reportCanvasError("SVG-Edit iframe 加载失败。");
    });

    // Real-Time Pipeline Progress Experience Elements
    const pipelineOverlay = $("pipelineOverlay");
    const pipelineToggleBtn = $("pipelineToggleBtn");
    const topbarProgressText = $("topbarProgressText");
    const pipelineStatusBadge = $("pipelineStatusBadge");
    const pipelineTimer = $("pipelineTimer");
    const pipelineCurrentStageText = $("pipelineCurrentStageText");
    const pipelinePercent = $("pipelinePercent");
    const pipelineProgressBar = $("pipelineProgressBar");
    const pipelineLiveLog = $("pipelineLiveLog");
    const pipelineToggleLogsBtn = $("pipelineToggleLogsBtn");
    const pipelineHideOverlayBtn = $("pipelineHideOverlayBtn");
    const step1Preview = $("step1Preview");
    const step2Preview = $("step2Preview");
    const step3Preview = $("step3Preview");
    const step4Preview = $("step4Preview");
    const step5Preview = $("step5Preview");

    let elapsedSeconds = 0;
    let timerTimerId = null;

    const setStepPreview = (el, src, alt) => {
      if (!el || !src) return;
      el.replaceChildren();
      const img = document.createElement("img");
      img.src = src;
      img.alt = alt || "";
      el.appendChild(img);
    };

    const setStepPreviewEmoji = (el, emoji) => {
      if (!el) return;
      el.replaceChildren();
      const mark = document.createElement("div");
      mark.style.fontSize = "16px";
      mark.textContent = emoji;
      el.appendChild(mark);
    };

    const startPipelineTimer = () => {
      if (timerTimerId) clearInterval(timerTimerId);
      elapsedSeconds = 0;
      if (pipelineTimer) pipelineTimer.textContent = "⏱️ 00:00";
      if (sideProgressTimer) sideProgressTimer.textContent = "⏱️ 00:00";
      timerTimerId = setInterval(() => {
        elapsedSeconds += 1;
        const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
        const secs = String(elapsedSeconds % 60).padStart(2, "0");
        const stamp = `⏱️ ${mins}:${secs}`;
        if (pipelineTimer) pipelineTimer.textContent = stamp;
        if (sideProgressTimer) sideProgressTimer.textContent = stamp;
      }, 1000);
    };

    const stopPipelineTimer = () => {
      if (timerTimerId) {
        clearInterval(timerTimerId);
        timerTimerId = null;
      }
    };

    const updatePipelineProgress = (stepIndex, percent, label, logLine = null, isFailed = false) => {
      // Keep step/percent monotonic so late/out-of-order events cannot regress UI,
      // but never let an early overshoot block later same-step label updates.
      if (typeof stepIndex === "number" && stepIndex > currentStep) {
        currentStep = stepIndex;
      }
      if (typeof percent === "number" && percent > currentPercentage) {
        currentPercentage = percent;
      }
      if (label) lastPipelineLabel = label;

      if (pipelinePercent) pipelinePercent.textContent = `${currentPercentage}%`;
      if (pipelineProgressBar) {
        pipelineProgressBar.style.width = `${currentPercentage}%`;
        pipelineProgressBar.classList.toggle("is-done", currentPercentage >= 100 && !isFailed);
        pipelineProgressBar.classList.toggle("is-failed", isFailed);
      }
      if (pipelineCurrentStageText && label) {
        pipelineCurrentStageText.textContent = label;
      }
      if (topbarProgressText) {
        topbarProgressText.textContent = `${currentPercentage}% · ${label || lastPipelineLabel || t("canvas.running")}`;
      }
      if (pipelineLiveLog && logLine) {
        pipelineLiveLog.textContent = logLine;
        pipelineLiveLog.dataset.i18nDefault = "0";
      }
      if (sideProgressTitle) {
        sideProgressTitle.textContent = label || lastPipelineLabel || t("canvas.waiting");
      }
      if (sideProgressPercent) sideProgressPercent.textContent = `${currentPercentage}%`;
      if (sideProgressFill) {
        sideProgressFill.style.width = `${currentPercentage}%`;
        sideProgressFill.classList.toggle("is-done", currentPercentage >= 100 && !isFailed);
        sideProgressFill.classList.toggle("is-failed", isFailed);
      }
      if (sideLiveLog && logLine) {
        sideLiveLog.textContent = logLine;
      } else if (sideLiveLog && label) {
        sideLiveLog.textContent = label;
      }
      if (statusDot) {
        statusDot.dataset.state = isFailed
          ? "failed"
          : statusState === "history"
            ? "history"
            : statusState === "done" || currentPercentage >= 100
              ? "done"
              : statusState === "disconnected"
                ? "disconnected"
                : statusState === "running" || currentPercentage > 0
                  ? "running"
                  : "waiting";
      }

      // Update Step milestone nodes & connectors
      const stepper = $("pipelineStepper");
      if (stepper) {
        const stepItems = stepper.querySelectorAll(".step-item");
        const connectors = stepper.querySelectorAll(".step-connector");
        stepItems.forEach((item) => {
          const stepId = parseInt(item.dataset.stepId, 10);
          item.classList.remove("is-active", "is-completed", "is-pending", "is-failed");
          if (isFailed && stepId === currentStep) {
            item.classList.add("is-failed");
          } else if (stepId < currentStep || (stepId === 5 && currentPercentage >= 100 && !isFailed)) {
            item.classList.add("is-completed");
          } else if (stepId === currentStep) {
            item.classList.add("is-active");
          } else {
            item.classList.add("is-pending");
          }
        });

        connectors.forEach((conn, index) => {
          const connStep = index + 1;
          conn.classList.toggle("is-filled", connStep < currentStep || (currentPercentage >= 100 && !isFailed));
        });
      }

      if (stepRail) {
        stepRail.querySelectorAll(".step-rail-item[data-step-id]").forEach((item) => {
          const stepId = parseInt(item.dataset.stepId, 10);
          item.classList.remove("is-active", "is-completed", "is-pending", "is-failed");
          if (isFailed && stepId === currentStep) {
            item.classList.add("is-failed");
          } else if (stepId < currentStep || (stepId === 5 && currentPercentage >= 100 && !isFailed)) {
            item.classList.add("is-completed");
          } else if (stepId === currentStep) {
            item.classList.add("is-active");
          } else {
            item.classList.add("is-pending");
          }
        });
      }
    };

    // Toggle Overlay Buttons
    if (pipelineToggleBtn) {
      pipelineToggleBtn.addEventListener("click", () => {
        if (pipelineOverlay) {
          pipelineOverlay.classList.toggle("is-hidden");
        }
      });
    }

    if (pipelineHideOverlayBtn) {
      pipelineHideOverlayBtn.addEventListener("click", () => {
        if (pipelineOverlay) {
          pipelineOverlay.classList.add("is-hidden");
        }
      });
    }

    if (sideOpenPipelineBtn) {
      sideOpenPipelineBtn.addEventListener("click", () => {
        if (pipelineOverlay) {
          pipelineOverlay.classList.remove("is-hidden");
        }
      });
    }

    if (pipelineToggleLogsBtn) {
      pipelineToggleLogsBtn.addEventListener("click", () => {
        setSidePanelTab("logs");
        if (logPanel) logPanel.classList.add("open");
      });
    }

    const stepMap = {
      figure: { step: 1, labelKey: "canvas.steps.figure" },
      samed: { step: 2, labelKey: "canvas.steps.samed" },
      icon_raw: { step: 3, labelKey: "canvas.steps.icon_raw" },
      icon_nobg: { step: 3, labelKey: "canvas.steps.icon_nobg" },
      template_svg: { step: 4, labelKey: "canvas.steps.template_svg" },
      optimized_template_svg: { step: 4, labelKey: "canvas.steps.optimized_template_svg" },
      final_svg: { step: 5, labelKey: "canvas.steps.final_svg" },
    };

    const artifacts = new Set();
    // Apply locale to pipeline chrome before first progress paint.
    if (source === "history") {
      lastPipelineLabel = t("canvas.pipeline.stage_history_ready");
      if (pipelineOverlay) pipelineOverlay.classList.add("is-hidden");
    }
    setCanvasLocale();

    // Prefill last-used multimodal scale / SVG model from job settings when available.
    try {
      const settingsRes = await engineFetch(`/api/history/${encodeURIComponent(jobId)}`);
      if (settingsRes.ok) {
        const item = await settingsRes.json();
        if (item?.settings?.multimodal_image_scale != null) {
          preferredMultimodalScale = normalizeMultimodalImageScale(
            item.settings.multimodal_image_scale
          );
          if (canvasMultimodalImageScale) {
            canvasMultimodalImageScale.value = preferredMultimodalScale;
          }
        }
        if (item?.settings?.svg_model) {
          preferredSvgModel = String(item.settings.svg_model).trim();
          if (canvasSvgModel && preferredSvgModel) {
            canvasSvgModel.value = preferredSvgModel;
          }
        }
      }
    } catch (_err) {
      // Ignore; defaults remain available.
    }

    // Fall back to active provider profile SVG model when job has none saved.
    if (!preferredSvgModel) {
      try {
        const profile = await getActiveProviderProfile();
        const provider = profile?.provider || "bianxie";
        preferredSvgModel =
          (profile?.svgModel && String(profile.svgModel).trim()) ||
          getDefaultSvgModelForProvider(provider);
        if (canvasSvgModel && preferredSvgModel) {
          canvasSvgModel.value = preferredSvgModel;
          canvasSvgModel.placeholder = preferredSvgModel;
        }
      } catch (_err) {
        preferredSvgModel = getDefaultSvgModelForProvider("bianxie");
        if (canvasSvgModel) {
          canvasSvgModel.value = preferredSvgModel;
          canvasSvgModel.placeholder = preferredSvgModel;
        }
      }
    }

    // Wire controls before the history early-return so reopen-from-history
    // still gets regenerate / scale / model listeners.
    if (resumeJobBtn) {
      resumeJobBtn.addEventListener("click", () => {
        void resumeCurrentJob();
      });
    }
    if (regenerateSvgBtn) {
      regenerateSvgBtn.addEventListener("click", () => {
        void regenerateSvgOnly();
      });
    }
    if (canvasMultimodalImageScale) {
      canvasMultimodalImageScale.addEventListener("change", () => {
        preferredMultimodalScale = normalizeMultimodalImageScale(
          canvasMultimodalImageScale.value
        );
      });
    }
    if (canvasSvgModel) {
      const rememberSvgModel = () => {
        const value = canvasSvgModel.value.trim();
        if (value) preferredSvgModel = value;
      };
      canvasSvgModel.addEventListener("change", rememberSvgModel);
      canvasSvgModel.addEventListener("input", rememberSvgModel);
    }

    if (source === "history") {
      if (pipelineOverlay) pipelineOverlay.classList.add("is-hidden");
      await loadHistoricalJob(false);
      return;
    }

    startPipelineTimer();
    updatePipelineProgress(1, 0, t("canvas.pipeline.stage_start"));
    updateSvgRerunControls();

    const eventSource = new EventSource(engineUrl(`/api/events/${jobId}`));

    eventSource.addEventListener("artifact", async (event) => {
      const data = JSON.parse(event.data);
      rememberArtifact(data);

      if (data.kind === "figure") {
        setStepPreview(step1Preview, engineUrl(data.url), "figure");
        // Figure ready → step 1 complete, step 2 active
        updatePipelineProgress(2, 25, t("canvas.pipeline.stage_sam"));
        updateSvgRerunControls();
      } else if (data.kind === "samed") {
        setStepPreview(step2Preview, engineUrl(data.url), "samed");
        updatePipelineProgress(3, 45, t("canvas.pipeline.stage_rmbg"));
        updateSvgRerunControls();
      } else if (data.kind === "icon_nobg" || data.kind === "icon_raw") {
        if (step3Preview && !step3Preview.hasChildNodes()) {
          setStepPreview(step3Preview, engineUrl(data.url), "icon");
        }
        updatePipelineProgress(3, 55, t("canvas.pipeline.stage_icons_ready"));
        updateSvgRerunControls();
      } else if (data.kind === "template_svg" || data.kind === "optimized_template_svg") {
        // Template SVG belongs to step 4 (rebuild), not final assembly.
        setStepPreviewEmoji(step4Preview, "📐");
        const pct = data.kind === "optimized_template_svg" ? 82 : 75;
        updatePipelineProgress(4, pct, t("canvas.pipeline.stage_template_ready"));
        await loadSvgAsset(engineUrl(data.url));
      } else if (data.kind === "final_svg") {
        setStepPreviewEmoji(step5Preview, "🎯");
        updatePipelineProgress(5, 100, t("canvas.pipeline.stage_all_done"));
        await loadSvgAsset(engineUrl(data.url));
      }

      if (stepMap[data.kind]) {
        const mapped = stepMap[data.kind].step;
        if (mapped > currentStep) currentStep = mapped;
        if (statusState === "running" || statusState === "waiting") {
          statusText.textContent = `Step ${Math.max(currentStep, mapped)}/5 - ${t(stepMap[data.kind].labelKey)}`;
        }
      }
    });

    eventSource.addEventListener("status", (event) => {
      const data = JSON.parse(event.data);
      if (data.state === "started") {
        statusState = "running";
        statusText.textContent = t("canvas.running");
        applyPipelineBadge();
        updateSvgRerunControls();
      } else if (data.state === "finished") {
        isFinished = true;
        stopPipelineTimer();
        if (typeof data.code === "number" && data.code !== 0) {
          statusState = "failed";
          statusText.textContent =
            currentLocale === "zh"
              ? `失败（code ${data.code}）`
              : `Failed (code ${data.code})`;
          applyPipelineBadge();
          updatePipelineProgress(
            currentStep || 1,
            currentPercentage,
            t("canvas.pipeline.stage_failed", { code: data.code }),
            null,
            true
          );
          updateResumeButtonVisibility();
          updateSvgRerunControls();
        } else {
          statusState = "done";
          statusText.textContent = t("canvas.done");
          applyPipelineBadge();
          if (pipelineToggleBtn) pipelineToggleBtn.classList.add("is-done");
          updatePipelineProgress(5, 100, t("canvas.pipeline.stage_all_done_short"));
          if (resumeJobBtn) resumeJobBtn.hidden = true;
          updateSvgRerunControls();
          // Auto minimize overlay after completion with smooth delay
          setTimeout(() => {
            if (pipelineOverlay && statusState === "done") {
              pipelineOverlay.classList.add("is-hidden");
            }
          }, 1500);
        }
      }
    });

    eventSource.addEventListener("log", (event) => {
      const data = JSON.parse(event.data);
      appendLogLine(logBody, data);
      const line = data.line || "";

      // Prefer structured step prefixes from autofigure2.py over broad substrings.
      if (line.includes("步骤一：") || line.includes("生成学术风格图片")) {
        updatePipelineProgress(1, 15, t("canvas.pipeline.stage_gen_figure"), line);
      } else if (line.includes("跳过步骤 1")) {
        updatePipelineProgress(2, 25, t("canvas.pipeline.stage_skip_figure"), line);
      } else if (line.includes("步骤二：") || line.includes("SAM3 分割")) {
        updatePipelineProgress(2, 35, t("canvas.pipeline.stage_sam"), line);
      } else if (line.includes("步骤三：") || line.includes("RMBG2 去背景")) {
        updatePipelineProgress(3, 50, t("canvas.pipeline.stage_rmbg"), line);
      } else if (line.includes("步骤四：") || line.includes("多模态调用生成 SVG")) {
        updatePipelineProgress(4, 70, t("canvas.pipeline.stage_svg_build"), line);
      } else if (
        line.includes("步骤 4.5：") ||
        line.includes("步骤 4.6：") ||
        line.includes("LLM 优化 SVG")
      ) {
        updatePipelineProgress(4, 78, t("canvas.pipeline.stage_svg_optimize"), line);
      } else if (line.includes("步骤 4.7：")) {
        // Coordinate alignment is still part of rebuild prep / late step 4.
        updatePipelineProgress(4, 85, t("canvas.pipeline.stage_svg_align"), line);
      } else if (line.includes("步骤五：") || line.includes("图标替换到 SVG")) {
        updatePipelineProgress(5, 90, t("canvas.pipeline.stage_assemble"), line);
      } else if (line) {
        if (pipelineLiveLog) {
          pipelineLiveLog.textContent = line;
          pipelineLiveLog.dataset.i18nDefault = "0";
        }
      }
    });

    let historyFallbackAttempted = false;
    eventSource.onerror = async () => {
      if (isFinished) {
        eventSource.close();
        return;
      }
      if (!historyFallbackAttempted) {
        historyFallbackAttempted = true;
        const loaded = await loadHistoricalJob(true);
        if (loaded) {
          eventSource.close();
          return;
        }
      }
      stopPipelineTimer();
      statusState = "disconnected";
      statusText.textContent = t("canvas.disconnected");
      applyPipelineBadge();
      if (pipelineCurrentStageText) {
        const label = lastPipelineLabel || t("canvas.disconnected");
        pipelineCurrentStageText.textContent = label;
      }
      if (topbarProgressText) {
        topbarProgressText.textContent = `${currentPercentage}% · ${t("canvas.disconnected")}`;
      }
      if (pipelineLiveLog) {
        pipelineLiveLog.textContent = t("canvas.disconnected");
        pipelineLiveLog.dataset.i18nDefault = "0";
      }
    };


    function hasArtifactKind(kind) {
      const cards = artifactList ? artifactList.querySelectorAll("[data-kind]") : [];
      for (const card of cards) {
        if (card.getAttribute("data-kind") === kind) return true;
      }
      for (const path of artifacts) {
        if (kind === "figure" && (path === "figure.png" || path.endsWith("/figure.png"))) return true;
        if (kind === "samed" && (path === "samed.png" || path.endsWith("/samed.png"))) return true;
        if (kind === "template_svg" && path.endsWith("template.svg") && !path.includes("optimized")) return true;
        if (kind === "final_svg" && path.endsWith("final.svg")) return true;
        if (
          kind === "icon_nobg" &&
          path.includes("icons/") &&
          path.endsWith("_nobg.png")
        ) {
          return true;
        }
        if (
          kind === "icon_raw" &&
          path.includes("icons/") &&
          path.endsWith(".png") &&
          !path.endsWith("_nobg.png")
        ) {
          return true;
        }
      }
      return false;
    }

    function canRegenerateSvg() {
      if (statusState === "running" || statusState === "waiting") return false;
      if (!hasArtifactKind("figure") || !hasArtifactKind("samed")) return false;
      // Icons may be absent in pure no-icon fallback mode; still allow SVG rebuild.
      return true;
    }

    function updateResumeButtonVisibility() {
      if (!resumeJobBtn) return;
      const canResume =
        statusState === "failed" &&
        hasArtifactKind("figure") &&
        hasArtifactKind("samed") &&
        source !== "history";
      resumeJobBtn.hidden = !canResume;
    }

    function updateSvgRerunControls() {
      if (!svgRerunControls) return;
      const show = canRegenerateSvg();
      svgRerunControls.hidden = !show;
      const busy = !show || statusState === "running" || statusState === "waiting";
      if (regenerateSvgBtn) {
        regenerateSvgBtn.disabled = busy;
      }
      if (canvasMultimodalImageScale) {
        canvasMultimodalImageScale.disabled = busy;
        canvasMultimodalImageScale.value = normalizeMultimodalImageScale(preferredMultimodalScale);
      }
      if (canvasSvgModel) {
        canvasSvgModel.disabled = busy;
        // Don't clobber in-progress typing while the field is focused.
        if (preferredSvgModel && document.activeElement !== canvasSvgModel) {
          canvasSvgModel.value = preferredSvgModel;
        }
      }
    }

    async function resumeCurrentJob() {
      if (!resumeJobBtn || resumeJobBtn.disabled) return;
      resumeJobBtn.disabled = true;
      const prev = resumeJobBtn.textContent;
      resumeJobBtn.textContent = t("canvas.resuming");
      try {
        let profile = null;
        try {
          profile = await getActiveProviderProfile();
        } catch (_err) {
          profile = null;
        }
        if (!profile || !profileHasApiKey(profile)) {
          throw new Error(t("canvas.resume_need_profile"));
        }
        if (!hasArtifactKind("figure") || !hasArtifactKind("samed")) {
          throw new Error(t("canvas.resume_need_artifacts"));
        }
        const provider = profile.provider || "custom";
        const payload = {
          resume_job_id: jobId,
          provider,
          api_key: profile.apiKey || null,
          base_url: provider === "custom" ? profile.baseUrl || null : null,
          svg_model: profile.svgModel || null,
          multimodal_image_scale: Number(
            normalizeMultimodalImageScale(
              canvasMultimodalImageScale?.value || preferredMultimodalScale
            )
          ),
        };
        const response = await engineFetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await readApiJson(response);
        const nextJob = data.job_id || jobId;
        // Resume starts a live run — never keep source=history or the page
        // will skip EventSource and show a static snapshot.
        const nextSource = source === "history" ? "import" : source || "input";
        window.location.href =
          `/canvas.html?job=${encodeURIComponent(nextJob)}&source=${encodeURIComponent(nextSource)}`;
      } catch (err) {
        appendLogLine(logBody, {
          stream: "canvas",
          line: `${t("canvas.resume_failed")}: ${err?.message || err}`,
        });
        statusText.textContent = err?.message || t("canvas.resume_failed");
        resumeJobBtn.disabled = false;
        resumeJobBtn.textContent = prev || t("canvas.resume");
      }
    }

    async function regenerateSvgOnly() {
      if (!regenerateSvgBtn || regenerateSvgBtn.disabled) return;
      if (statusState === "running" || statusState === "waiting") {
        statusText.textContent = t("canvas.svg_rerun_running");
        return;
      }
      regenerateSvgBtn.disabled = true;
      const prev = regenerateSvgBtn.textContent;
      regenerateSvgBtn.textContent = t("canvas.svg_rerunning");
      try {
        let profile = null;
        try {
          profile = await getActiveProviderProfile();
        } catch (_err) {
          profile = null;
        }
        if (!profile || !profileHasApiKey(profile)) {
          throw new Error(t("canvas.svg_rerun_need_profile"));
        }
        if (!hasArtifactKind("figure") || !hasArtifactKind("samed")) {
          throw new Error(t("canvas.svg_rerun_need_artifacts"));
        }
        const scale = normalizeMultimodalImageScale(
          canvasMultimodalImageScale?.value || preferredMultimodalScale
        );
        preferredMultimodalScale = scale;
        const provider = profile.provider || "custom";
        const selectedSvgModel =
          (canvasSvgModel?.value || "").trim() ||
          preferredSvgModel ||
          profile.svgModel ||
          getDefaultSvgModelForProvider(provider) ||
          null;
        if (selectedSvgModel) preferredSvgModel = selectedSvgModel;
        const payload = {
          resume_job_id: jobId,
          start_from: 4,
          provider,
          api_key: profile.apiKey || null,
          base_url: provider === "custom" ? profile.baseUrl || null : null,
          svg_model: selectedSvgModel,
          multimodal_image_scale: Number(scale),
        };
        const response = await engineFetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await readApiJson(response);
        const nextJob = data.job_id || jobId;
        // SVG rerun is a live job. Drop source=history so the canvas attaches
        // to EventSource instead of treating it as a finished snapshot.
        const nextSource = source === "history" ? "import" : source || "input";
        window.location.href =
          `/canvas.html?job=${encodeURIComponent(nextJob)}&source=${encodeURIComponent(nextSource)}`;
      } catch (err) {
        appendLogLine(logBody, {
          stream: "canvas",
          line: `${t("canvas.svg_rerun_failed")}: ${err?.message || err}`,
        });
        statusText.textContent = err?.message || t("canvas.svg_rerun_failed");
        regenerateSvgBtn.disabled = false;
        regenerateSvgBtn.textContent = prev || t("canvas.svg_rerun_btn");
        updateSvgRerunControls();
      }
    }

    function rememberArtifact(data, prepend = true) {
      if (!data || !data.path || artifacts.has(data.path)) {
        return;
      }
      artifacts.add(data.path);
      addArtifactCard(artifactList, data, { prepend });
    }

    async function loadHistoricalJob(silent) {
      try {
        const response = await engineFetch(`/api/history/${encodeURIComponent(jobId)}`);
        if (!response.ok) {
          throw new Error("History job not found");
        }
        const item = await response.json();
        if (item?.settings?.multimodal_image_scale != null) {
          preferredMultimodalScale = normalizeMultimodalImageScale(
            item.settings.multimodal_image_scale
          );
          if (canvasMultimodalImageScale) {
            canvasMultimodalImageScale.value = preferredMultimodalScale;
          }
        }
        if (item?.settings?.svg_model) {
          preferredSvgModel = String(item.settings.svg_model).trim();
          if (canvasSvgModel && preferredSvgModel) {
            canvasSvgModel.value = preferredSvgModel;
          }
        }
        const historicalArtifacts = Array.isArray(item.artifacts) ? item.artifacts : [];
        for (const artifact of historicalArtifacts) {
          rememberArtifact(artifact, false);
        }

        // Paint step previews from historical artifacts so the pipeline card
        // doesn't look like a fresh run stuck at step 1.
        const figureArtifact = findFirstArtifact(historicalArtifacts, ["figure"]);
        const samedArtifact = findFirstArtifact(historicalArtifacts, ["samed"]);
        const iconArtifact = findFirstArtifact(historicalArtifacts, [
          "icon_nobg",
          "icon_raw",
        ]);
        if (figureArtifact) {
          setStepPreview(step1Preview, engineUrl(figureArtifact.url), "figure");
        }
        if (samedArtifact) {
          setStepPreview(step2Preview, engineUrl(samedArtifact.url), "samed");
        }
        if (iconArtifact) {
          setStepPreview(step3Preview, engineUrl(iconArtifact.url), "icon");
        }

        const svgArtifact = findFirstArtifact(historicalArtifacts, [
          "final_svg",
          "optimized_template_svg",
          "template_svg",
        ]);
        const imageArtifact = findFirstArtifact(historicalArtifacts, ["figure", "samed"]);
        if (svgArtifact) {
          if (
            svgArtifact.kind === "final_svg" ||
            svgArtifact.kind === "optimized_template_svg" ||
            svgArtifact.kind === "template_svg"
          ) {
            setStepPreviewEmoji(step4Preview, "📐");
          }
          if (svgArtifact.kind === "final_svg") {
            setStepPreviewEmoji(step5Preview, "🎯");
          }
          await loadSvgAsset(engineUrl(svgArtifact.url));
        } else if (imageArtifact) {
          loadImageAsset(imageArtifact);
        }

        // Derive completed progress from artifacts. History opens are view-only
        // snapshots — never leave the UI in the default "running / step 1" state.
        stopPipelineTimer();
        isFinished = true;
        statusState = "history";
        statusText.textContent = t("canvas.history_ready");

        let historyStep = 1;
        let historyPercent = 0;
        let historyLabel = t("canvas.pipeline.stage_history_ready");
        if (findFirstArtifact(historicalArtifacts, ["final_svg"])) {
          historyStep = 5;
          historyPercent = 100;
          historyLabel = t("canvas.pipeline.stage_all_done_short");
        } else if (
          findFirstArtifact(historicalArtifacts, [
            "optimized_template_svg",
            "template_svg",
          ])
        ) {
          historyStep = 4;
          historyPercent = 82;
          historyLabel = t("canvas.pipeline.stage_template_ready");
        } else if (findFirstArtifact(historicalArtifacts, ["icon_nobg", "icon_raw"])) {
          historyStep = 3;
          historyPercent = 55;
          historyLabel = t("canvas.pipeline.stage_icons_ready");
        } else if (findFirstArtifact(historicalArtifacts, ["samed"])) {
          historyStep = 3;
          historyPercent = 45;
          historyLabel = t("canvas.pipeline.stage_rmbg");
        } else if (findFirstArtifact(historicalArtifacts, ["figure"])) {
          historyStep = 2;
          historyPercent = 25;
          historyLabel = t("canvas.pipeline.stage_sam");
        }

        // Reset monotonic guards so history paint is authoritative.
        currentStep = 0;
        currentPercentage = 0;
        lastPipelineLabel = historyLabel;
        updatePipelineProgress(historyStep, historyPercent, historyLabel);
        applyPipelineBadge();
        if (pipelineOverlay) {
          // History is for editing the result, not watching a live run.
          pipelineOverlay.classList.add("is-hidden");
        }
        if (sideLiveLog) {
          sideLiveLog.textContent = t("canvas.history_ready");
          sideLiveLog.dataset.i18nDefault = "0";
        }
        updateSvgRerunControls();
        updateResumeButtonVisibility();
        return true;
      } catch (_err) {
        if (!silent) {
          stopPipelineTimer();
          statusState = "disconnected";
          statusText.textContent = t("canvas.history_not_found");
          applyPipelineBadge();
          updateSvgRerunControls();
        }
        return false;
      }
    }

    function findFirstArtifact(items, kinds) {
      for (const kind of kinds) {
        const found = items.find((item) => item.kind === kind);
        if (found) {
          return found;
        }
      }
      return null;
    }

    async function loadSvgAsset(url) {
      pendingSvgUrl = url;
      let svgText = "";
      try {
        const response = await fetch(engineUrl(url), { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        svgText = await response.text();
      } catch (err) {
        // Still show the raw SVG via <object> when the editor path is unavailable.
        fallbackObject.data = engineUrl(url);
        reportCanvasError(`SVG 素材读取失败: ${err?.message || err}`);
        return;
      }

      if (svgEditAvailable) {
        if (!svgEditPath) {
          fallbackObject.data = engineUrl(url);
          return;
        }
        if (!svgReady) {
          pendingSvgText = svgText;
          return;
        }

        const loaded = await tryLoadSvg(svgText);
        if (!loaded) {
          pendingSvgText = svgText;
          fallbackObject.data = engineUrl(url);
        }
      } else {
        fallbackObject.data = engineUrl(url);
      }
    }

    function loadImageAsset(artifact) {
      fallbackMode = "history_image";
      iframe.style.display = "none";
      fallback.classList.add("active");
      fallbackObject.data = engineUrl(artifact.url);
      setCanvasLocale();
    }

    function fitSvgEditorToCanvas(win) {
      // Generated figures are often 2K–4K; default 100% zoom only shows a corner.
      // Fit the full artboard into the workarea, scaled from the SVG's own size.
      const editor = win?.svgEditor;
      if (!editor) return;

      const applyFit = () => {
        try {
          if (typeof editor.zoomChanged === "function") {
            // Built-in "fit to canvas": zoom = min(workarea/content) * 0.95
            editor.zoomChanged(win, "canvas");
            return;
          }
          const canvas = editor.svgCanvas || win.svgCanvas;
          const workarea =
            editor.workarea || win.document?.getElementById("workarea");
          if (!canvas || typeof canvas.setBBoxZoom !== "function" || !workarea) {
            return;
          }
          const width =
            parseFloat(getComputedStyle(workarea).width) || workarea.clientWidth;
          const height =
            parseFloat(getComputedStyle(workarea).height) ||
            workarea.clientHeight;
          if (!(width > 0) || !(height > 0)) return;
          canvas.setBBoxZoom("canvas", width - 15, height - 15);
          if (typeof editor.updateCanvas === "function") {
            editor.updateCanvas(true);
          }
          const zoomInput = win.document?.getElementById("zoom");
          if (zoomInput && typeof canvas.getZoom === "function") {
            zoomInput.value = (canvas.getZoom() * 100).toFixed(1);
          }
        } catch (_err) {
          // Fit is best-effort; a failed fit should not block a successful load.
        }
      };

      // Wait a couple frames so workarea has real layout size after setSvgString.
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(applyFit);
      });
    }

    async function tryLoadSvg(svgText) {
      if (!iframe.contentWindow) {
        return false;
      }

      const win = iframe.contentWindow;
      try {
        if (win.svgEditor && typeof win.svgEditor.loadFromString === "function") {
          await win.svgEditor.loadFromString(svgText);
          fitSvgEditorToCanvas(win);
          return true;
        }
        if (win.svgCanvas && typeof win.svgCanvas.setSvgString === "function") {
          win.svgCanvas.setSvgString(svgText);
          fitSvgEditorToCanvas(win);
          return true;
        }
      } catch (error) {
        reportCanvasError(`SVG 加载失败: ${error?.message || error}`);
      }
      return false;
    }
  }

  function appendLogLine(container, data) {
    if (!container) return;
    const line = `[${data.stream || "engine"}] ${data.line || ""}`;
    // Prefer structured lines so search/filter can hide individual rows.
    if (container.classList.contains("log-body") || container.id === "logBody") {
      const row = document.createElement("div");
      row.className = "log-line-item";
      const lower = line.toLowerCase();
      if (lower.includes("error") || lower.includes("failed") || lower.includes("traceback")) {
        row.classList.add("is-error");
      } else if (lower.includes("warn")) {
        row.classList.add("is-warning");
      }
      row.textContent = line;
      container.appendChild(row);
      while (container.childElementCount > 400) {
        container.removeChild(container.firstElementChild);
      }
      const filter = $("logsFilterInput");
      if (filter && filter.value.trim()) {
        const query = filter.value.trim().toLowerCase();
        row.hidden = !line.toLowerCase().includes(query);
      }
      container.scrollTop = container.scrollHeight;
      return;
    }
    const lines = container.textContent.split("\n").filter(Boolean);
    lines.push(line);
    if (lines.length > 200) {
      lines.splice(0, lines.length - 200);
    }
    container.textContent = lines.join("\n");
    container.scrollTop = container.scrollHeight;
  }

  function addArtifactCard(container, data, options = {}) {
    const prepend = options.prepend !== false;
    const card = document.createElement("a");
    card.className = "artifact-card";
    if (data.kind) {
      card.setAttribute("data-kind", data.kind);
    }
    if (data.path) {
      card.setAttribute("data-path", data.path);
    }
    card.href = engineUrl(data.url);
    card.target = "_blank";
    card.rel = "noreferrer";

    let media;
    if (isPreviewableArtifact(data.kind)) {
      media = document.createElement("img");
      media.src = engineUrl(data.url);
      media.alt = data.name;
      media.loading = "lazy";
    } else {
      media = document.createElement("div");
      media.className = "artifact-file-icon";
      media.textContent = data.kind === "log" ? "LOG" : "JSON";
    }

    const meta = document.createElement("div");
    meta.className = "artifact-meta";

    const name = document.createElement("div");
    name.className = "artifact-name";
    name.textContent = data.name;

    const badge = document.createElement("div");
    badge.className = "artifact-badge";
    badge.textContent = formatKind(data.kind);

    meta.appendChild(name);
    meta.appendChild(badge);
    card.appendChild(media);
    card.appendChild(meta);
    if (prepend) {
      container.prepend(card);
    } else {
      container.appendChild(card);
    }
  }

  function isPreviewableArtifact(kind) {
    return [
      "figure",
      "samed",
      "icon_raw",
      "icon_nobg",
      "template_svg",
      "optimized_template_svg",
      "final_svg",
    ].includes(kind);
  }

  function formatKind(kind) {
    switch (kind) {
      case "figure":
        return currentLocale === "zh" ? "原图" : "figure";
      case "samed":
        return currentLocale === "zh" ? "分割标注" : "samed";
      case "icon_raw":
        return currentLocale === "zh" ? "原始图标" : "icon raw";
      case "icon_nobg":
        return currentLocale === "zh" ? "去背景图标" : "icon no-bg";
      case "template_svg":
        return currentLocale === "zh" ? "模板 SVG" : "template";
      case "optimized_template_svg":
        return currentLocale === "zh" ? "优化模板" : "optimized";
      case "final_svg":
        return currentLocale === "zh" ? "最终 SVG" : "final";
      case "boxlib":
        return currentLocale === "zh" ? "坐标数据" : "box data";
      case "log":
        return currentLocale === "zh" ? "日志" : "log";
      default:
        return currentLocale === "zh" ? "素材" : "artifact";
    }
  }
})();
