# Copyright (c) Meta Platforms, Inc. and affiliates. All Rights Reserved

# pyre-unsafe

import torch

addmm_act_op = torch.ops.aten._addmm_activation


def addmm_act(activation, linear, mat1):
    if torch.is_grad_enabled():
        raise ValueError("Expected grad to be disabled.")
    self = linear.bias.detach()
    mat2 = linear.weight.detach()
    # Official SAM3 demos run this fused MLP under CUDA BF16 autocast. On
    # CPU-only torch builds the following Linear (fc2) stays Float32, so forcing
    # BF16 here produces "mat1 BFloat16 / mat2 Float" in Mlp.forward.
    compute_dtype = torch.bfloat16 if mat1.is_cuda else mat1.dtype
    self = self.to(compute_dtype)
    mat1 = mat1.to(compute_dtype)
    mat2 = mat2.to(compute_dtype)
    mat1_flat = mat1.view(-1, mat1.shape[-1])
    if activation in [torch.nn.functional.relu, torch.nn.ReLU]:
        y = addmm_act_op(self, mat1_flat, mat2.t(), beta=1, alpha=1, use_gelu=False)
        return y.view(mat1.shape[:-1] + (y.shape[-1],))
    if activation in [torch.nn.functional.gelu, torch.nn.GELU]:
        y = addmm_act_op(self, mat1_flat, mat2.t(), beta=1, alpha=1, use_gelu=True)
        return y.view(mat1.shape[:-1] + (y.shape[-1],))
    raise ValueError(f"Unexpected activation {activation}")
