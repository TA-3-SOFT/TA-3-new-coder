package com.github.continuedev.continueintellijextension.model;

import java.util.List;

public class GenerateCommitMsgParam {
    private String requestId;
    private List<String> codeDiffs;
    private List<String> commitMessages;
    private Boolean stream;
    private String preferredLanguage;

    
    public static GenerateCommitMsgParamBuilder builder() {
        return new GenerateCommitMsgParamBuilder();
    }

    
    public String getRequestId() {
        return this.requestId;
    }

    
    public List<String> getCodeDiffs() {
        return this.codeDiffs;
    }

    
    public List<String> getCommitMessages() {
        return this.commitMessages;
    }

    
    public Boolean getStream() {
        return this.stream;
    }

    
    public String getPreferredLanguage() {
        return this.preferredLanguage;
    }

    
    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    
    public void setCodeDiffs(List<String> codeDiffs) {
        this.codeDiffs = codeDiffs;
    }

    
    public void setCommitMessages(List<String> commitMessages) {
        this.commitMessages = commitMessages;
    }

    
    public void setStream(Boolean stream) {
        this.stream = stream;
    }

    
    public void setPreferredLanguage(String preferredLanguage) {
        this.preferredLanguage = preferredLanguage;
    }

    
    public boolean equals(Object o) {
        if (o == this) {
            return true;
        } else if (!(o instanceof GenerateCommitMsgParam)) {
            return false;
        } else {
            GenerateCommitMsgParam other = (GenerateCommitMsgParam)o;
            if (!other.canEqual(this)) {
                return false;
            } else {
                Object this$requestId = this.getRequestId();
                Object other$requestId = other.getRequestId();
                if (this$requestId == null) {
                    if (other$requestId != null) {
                        return false;
                    }
                } else if (!this$requestId.equals(other$requestId)) {
                    return false;
                }

                Object this$codeDiffs = this.getCodeDiffs();
                Object other$codeDiffs = other.getCodeDiffs();
                if (this$codeDiffs == null) {
                    if (other$codeDiffs != null) {
                        return false;
                    }
                } else if (!this$codeDiffs.equals(other$codeDiffs)) {
                    return false;
                }

                Object this$commitMessages = this.getCommitMessages();
                Object other$commitMessages = other.getCommitMessages();
                if (this$commitMessages == null) {
                    if (other$commitMessages != null) {
                        return false;
                    }
                } else if (!this$commitMessages.equals(other$commitMessages)) {
                    return false;
                }

                Object this$stream = this.getStream();
                Object other$stream = other.getStream();
                if (this$stream == null) {
                    if (other$stream != null) {
                        return false;
                    }
                } else if (!this$stream.equals(other$stream)) {
                    return false;
                }

                Object this$preferredLanguage = this.getPreferredLanguage();
                Object other$preferredLanguage = other.getPreferredLanguage();
                if (this$preferredLanguage == null) {
                    if (other$preferredLanguage != null) {
                        return false;
                    }
                } else if (!this$preferredLanguage.equals(other$preferredLanguage)) {
                    return false;
                }

                return true;
            }
        }
    }

    
    protected boolean canEqual(Object other) {
        return other instanceof GenerateCommitMsgParam;
    }

    
    public int hashCode() {
        int PRIME = 59;
        int result = 1;
        Object $requestId = this.getRequestId();
        result = result * 59 + ($requestId == null ? 43 : $requestId.hashCode());
        Object $codeDiffs = this.getCodeDiffs();
        result = result * 59 + ($codeDiffs == null ? 43 : $codeDiffs.hashCode());
        Object $commitMessages = this.getCommitMessages();
        result = result * 59 + ($commitMessages == null ? 43 : $commitMessages.hashCode());
        Object $stream = this.getStream();
        result = result * 59 + ($stream == null ? 43 : $stream.hashCode());
        Object $preferredLanguage = this.getPreferredLanguage();
        result = result * 59 + ($preferredLanguage == null ? 43 : $preferredLanguage.hashCode());
        return result;
    }

    
    public String toString() {
        String var10000 = this.getRequestId();
        return "GenerateCommitMsgParam(requestId=" + var10000 + ", codeDiffs=" + this.getCodeDiffs() + ", commitMessages=" + this.getCommitMessages() + ", stream=" + this.getStream() + ", preferredLanguage=" + this.getPreferredLanguage() + ")";
    }

    
    public GenerateCommitMsgParam(String requestId, List<String> codeDiffs, List<String> commitMessages, Boolean stream, String preferredLanguage) {
        this.requestId = requestId;
        this.codeDiffs = codeDiffs;
        this.commitMessages = commitMessages;
        this.stream = stream;
        this.preferredLanguage = preferredLanguage;
    }

    
    public GenerateCommitMsgParam() {
    }

    
    public static class GenerateCommitMsgParamBuilder {
        
        private String requestId;
        
        private List<String> codeDiffs;
        
        private List<String> commitMessages;
        
        private Boolean stream;
        
        private String preferredLanguage;

        
        GenerateCommitMsgParamBuilder() {
        }

        
        public GenerateCommitMsgParamBuilder requestId(String requestId) {
            this.requestId = requestId;
            return this;
        }

        
        public GenerateCommitMsgParamBuilder codeDiffs(List<String> codeDiffs) {
            this.codeDiffs = codeDiffs;
            return this;
        }

        
        public GenerateCommitMsgParamBuilder commitMessages(List<String> commitMessages) {
            this.commitMessages = commitMessages;
            return this;
        }

        
        public GenerateCommitMsgParamBuilder stream(Boolean stream) {
            this.stream = stream;
            return this;
        }

        
        public GenerateCommitMsgParamBuilder preferredLanguage(String preferredLanguage) {
            this.preferredLanguage = preferredLanguage;
            return this;
        }

        
        public GenerateCommitMsgParam build() {
            return new GenerateCommitMsgParam(this.requestId, this.codeDiffs, this.commitMessages, this.stream, this.preferredLanguage);
        }

        
        public String toString() {
            return "GenerateCommitMsgParam.GenerateCommitMsgParamBuilder(requestId=" + this.requestId + ", codeDiffs=" + this.codeDiffs + ", commitMessages=" + this.commitMessages + ", stream=" + this.stream + ", preferredLanguage=" + this.preferredLanguage + ")";
        }
    }
}
